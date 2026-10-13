"""x402 v2 over HTTP with the m2m-split scheme (section G; D15, D21, D34).

Payer: `PaymentClient` answers a 402 by paying and retrying with PAYMENT-SIGNATURE.
Payee: `Paywall` produces the 402 and settles the payment before the handler runs.
"""

import base64
import json
import uuid
from dataclasses import dataclass, field

import httpx
from solders.keypair import Keypair

from .api import ApiClient
from .constants import M2M_SPLIT, X402_VERSION
from .errors import M2mError
from .payment import pay_quote, submit_payment, verify_payment
from .quote import split_expectation, verify_quote
from .rpc import Rpc
from .split import verify_split_transaction

PAYMENT_REQUIRED = "PAYMENT-REQUIRED"
PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE"
PAYMENT_RESPONSE = "PAYMENT-RESPONSE"


def encode_header(value) -> str:
    return base64.b64encode(json.dumps(value, ensure_ascii=False).encode("utf-8")).decode()


def decode_header(header: str):
    try:
        return json.loads(base64.b64decode(header).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise M2mError("INVALID_REQUEST", "Malformed x402 header.") from e


def quote_from_requirements(requirements: dict) -> dict:
    if requirements.get("scheme") != M2M_SPLIT or not requirements.get("extra"):
        raise M2mError("INVALID_REQUEST", "Not an m2m-split payment requirement.")
    return {k: v for k, v in requirements["extra"].items() if k != "paymentFlow"}


def payment_id_of(payload: dict) -> str | None:
    pid = (
        ((payload.get("extensions") or {}).get("payment-identifier") or {})
        .get("info", {})
        .get("id")
    )
    return pid if isinstance(pid, str) and 16 <= len(pid) <= 128 else None


def payment_required(quote: dict, resource: dict) -> dict:
    """The 402 body for an m2m-split payment; same shape as the TypeScript SDK."""
    schema = "https://json-schema.org/draft/2020-12/schema"
    return {
        "x402Version": X402_VERSION,
        "error": f"{PAYMENT_SIGNATURE} header is required",
        "resource": resource,
        "accepts": [
            {
                "scheme": M2M_SPLIT,
                "network": quote["network"],
                "amount": quote["amount"],
                "asset": quote["mint"],
                "payTo": quote["payee"],
                "maxTimeoutSeconds": 30,
                "extra": {**quote, "paymentFlow": "upfront"},
            }
        ],
        "extensions": {
            "payment-identifier": {
                "info": {"required": True},
                "schema": {
                    "$schema": schema,
                    "type": "object",
                    "properties": {
                        "required": {"type": "boolean"},
                        "id": {"type": "string", "minLength": 16, "maxLength": 128},
                    },
                    "required": ["required"],
                },
            },
            "m2m-referral": {
                "info": {"link": quote["referral"]},
                "schema": {
                    "$schema": schema,
                    "type": "object",
                    "properties": {"link": {"type": "string"}},
                },
            },
        },
    }


class PaymentClient:
    """Payer side: an HTTP client that pays m2m-split 402s and retries the request."""

    def __init__(
        self,
        rpc: Rpc,
        keypair: Keypair,
        service_address: str,
        *,
        network: str | None = None,
        http: httpx.Client | None = None,
    ) -> None:
        self.rpc = rpc
        self.keypair = keypair
        self.service_address = service_address
        self.network = network
        self.http = http or httpx.Client(timeout=60)

    def payment_payload(self, required: dict) -> dict | None:
        accepted = next(
            (
                a
                for a in required.get("accepts", [])
                if a.get("scheme") == M2M_SPLIT
                and (not self.network or a["network"] == self.network)
            ),
            None,
        )
        if not accepted:
            return None
        quote = quote_from_requirements(accepted)
        paid = pay_quote(self.rpc, self.keypair, quote, self.service_address)
        extensions = dict(required.get("extensions") or {})
        extensions["payment-identifier"] = {
            **extensions.get("payment-identifier", {}),
            "info": {"required": True, "id": f"pay_{uuid.uuid4().hex}"},
        }
        return {
            "x402Version": X402_VERSION,
            "resource": required.get("resource"),
            "accepted": accepted,
            "payload": {"transaction": paid["transaction"]},
            "extensions": extensions,
        }

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        response = self.http.request(method, url, **kwargs)
        header = response.headers.get(PAYMENT_REQUIRED)
        if response.status_code != 402 or not header:
            return response
        payload = self.payment_payload(decode_header(header))
        if payload is None:
            return response
        headers = {**(kwargs.pop("headers", None) or {}), PAYMENT_SIGNATURE: encode_header(payload)}
        return self.http.request(method, url, headers=headers, **kwargs)

    def get(self, url: str, **kwargs) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> httpx.Response:
        return self.request("POST", url, **kwargs)


def settlement_of(response: httpx.Response) -> dict | None:
    header = response.headers.get(PAYMENT_RESPONSE)
    return decode_header(header) if header else None


@dataclass
class PaywallOutcome:
    """`paid` False: answer with status, headers and body. True: run the handler and add headers."""

    paid: bool
    status: int = 200
    headers: dict = field(default_factory=dict)
    body: bytes = b""
    settlement: dict | None = None


class Paywall:
    """Payee side: framework-agnostic m2m-split paywall (payment flow `upfront`)."""

    def __init__(
        self, api: ApiClient, rpc: Rpc, network: str, payee: str, *, submit: str = "relay"
    ) -> None:
        self.api, self.rpc, self.network, self.payee, self.submit = api, rpc, network, payee, submit

    def handle(
        self, headers, url: str, price: dict, resource: dict | None = None
    ) -> PaywallOutcome:
        """`headers` are the request headers; `price` is {"mint": ..., "amount": ...}."""
        header = next(
            (v for k, v in headers.items() if k.lower() == PAYMENT_SIGNATURE.lower()), None
        )
        if not header:
            quote = self.api.request_quote(
                self.network, price["mint"], price["amount"], self.payee, f"402-{uuid.uuid4()}"
            )
            body = payment_required(quote, {"url": url, **(resource or {})})
            return PaywallOutcome(
                paid=False,
                status=402,
                headers={PAYMENT_REQUIRED: encode_header(body), "content-type": "application/json"},
                body=json.dumps(body).encode(),
            )
        try:
            settlement, payer = self._settle(decode_header(header), price)
        except M2mError as e:
            failure = {
                "success": False,
                "errorReason": e.code,
                "transaction": "",
                "network": self.network,
            }
            return PaywallOutcome(
                paid=False,
                status=402,
                headers={
                    PAYMENT_RESPONSE: encode_header(failure),
                    "content-type": "application/json",
                },
                body=json.dumps({"error": {"code": e.code, "message": str(e)}}).encode(),
            )
        success = {
            "success": True,
            "transaction": settlement["signature"],
            "network": self.network,
            "payer": payer,
            "amount": settlement["receipt_data"]["amount"],
            "extensions": {
                "m2m-receipt": {"info": {"receipt": settlement["receipt"]}},
                "m2m-referral": {"info": {"link": settlement["receipt_data"]["referral"]}},
            },
        }
        return PaywallOutcome(
            paid=True, headers={PAYMENT_RESPONSE: encode_header(success)}, settlement=settlement
        )

    def _settle(self, payload: dict, price: dict) -> tuple[dict, str]:
        if payload.get("x402Version") != X402_VERSION:
            raise M2mError("INVALID_REQUEST", f"Only x402 version {X402_VERSION} is supported.")
        quote = quote_from_requirements(payload.get("accepted") or {})
        if (
            quote["payee"] != self.payee
            or quote["network"] != self.network
            or quote["mint"] != price["mint"]
            or quote["amount"] != str(price["amount"])
        ):
            raise M2mError(
                "PAYMENT_TRANSACTION_INVALID", "The quote is not for this resource's price."
            )
        transaction = (payload.get("payload") or {}).get("transaction")
        if not isinstance(transaction, str):
            raise M2mError("INVALID_REQUEST", "payload.transaction is required.")
        payment_id = payment_id_of(payload)
        if not payment_id:
            raise M2mError("INVALID_REQUEST", "The payment-identifier extension id is required.")
        service = self.api.service_address()
        if self.submit == "self":
            verified = verify_payment(self.rpc, quote, transaction, service)
            signature = submit_payment(self.rpc, transaction)
            return self.api.report_payment(quote, signature), verified["payer"]
        # The relay simulates, enforces expiry and single use, and answers retries idempotently.
        if not verify_quote(quote, service):
            raise M2mError("QUOTE_INVALID")
        verified = verify_split_transaction(transaction, split_expectation(quote), signed=True)
        return self.api.relay_payment(quote, transaction, payment_id), verified["payer"]
