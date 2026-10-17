"""x402 v2 over HTTP with the m2m-split scheme (section G; D15, D21, D34).

Payer: `PaymentClient` answers a 402 by paying and retrying with PAYMENT-SIGNATURE, never
paying twice for one request (D66).
Payee: `Paywall` produces the 402 and settles the payment before the handler runs.
"""

import base64
import json
import threading
import uuid
import weakref
from dataclasses import dataclass, field

import httpx
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction

from .api import ApiClient
from .constants import M2M_SPLIT, X402_VERSION
from .errors import M2mError
from .payment import pay_quote, submit_payment, verify_payment
from .quote import split_expectation, verify_quote
from .receipt import verify_receipt
from .retry import chain_evidence, decide_retry, request_key
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


_outcomes: "weakref.WeakKeyDictionary[httpx.Response, dict]" = weakref.WeakKeyDictionary()


def payment_outcome(response: httpx.Response) -> dict | None:
    """Outcome of a request `PaymentClient` paid for; None if it carried no payment.

    Keys: status ("paid", "already_paid" or "not_paid"), payment_id, transaction, and receipt /
    receipt_data when available (receipt_data only when the SDK verified the receipt).
    """
    return _outcomes.get(response)


class PaymentClient:
    """Payer side: an HTTP client that pays m2m-split 402s and retries the request.

    It never pays twice for one request (D66). The signed payment is kept in memory, bound to the
    request (its Idempotency-Key header, else method, URL and body), until its outcome is known.
    Repeating the request resends the same payment instead of requesting a new quote. Read the
    outcome with `payment_outcome(response)`. If the outcome cannot be determined, it raises
    PAYMENT_STATUS_UNKNOWN and keeps the payment; repeat the request later. Concurrent calls for
    the same request share one attempt. Pending payments live in memory only: after a restart,
    check the chain before paying again (D67).
    """

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
        self._pending: dict[str, dict] = {}
        # Concurrent calls for the same request share one attempt, so they never sign twice (D67).
        self._lock = threading.Lock()
        self._inflight: dict[str, dict] = {}

    def _sign(self, required: dict) -> dict | None:
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
        payment_id = f"pay_{uuid.uuid4().hex}"
        extensions = dict(required.get("extensions") or {})
        extensions["payment-identifier"] = {
            **extensions.get("payment-identifier", {}),
            "info": {"required": True, "id": payment_id},
        }
        payload = {
            "x402Version": X402_VERSION,
            "resource": required.get("resource"),
            "accepted": accepted,
            "payload": {"transaction": paid["transaction"]},
            "extensions": extensions,
        }
        transaction = VersionedTransaction.from_bytes(base64.b64decode(paid["transaction"]))
        return {
            "payload": payload,
            "header": encode_header(payload),
            "payment_id": payment_id,
            "quote_id": quote["id"],
            "signature": str(transaction.signatures[0]),
            "last_valid_block_height": paid["last_valid_block_height"],
        }

    def payment_payload(self, required: dict) -> dict | None:
        """Signs a payment for a 402 and returns the PAYMENT-SIGNATURE payload (no retry logic)."""
        signed = self._sign(required)
        return signed["payload"] if signed else None

    def _resolve(self, payment: dict, response: httpx.Response) -> dict:
        s = settlement_of(response) or {}
        receipt = (
            ((s.get("extensions") or {}).get("m2m-receipt") or {}).get("info", {}).get("receipt")
        )
        base = {"payment_id": payment["payment_id"], "transaction": payment["signature"]}

        settlement = "other"
        if s.get("success") and s.get("transaction") == payment["signature"]:
            settlement = "success"
        elif response.status_code == 402 and s.get("errorReason") == "QUOTE_EXPIRED":
            settlement = (
                "quote_expired_with_receipt"
                if s.get("transaction") and receipt
                else "quote_expired_without_receipt"
            )
        if settlement == "success":
            return {"status": "paid", **base, **({"receipt": receipt} if receipt else {})}

        if settlement == "quote_expired_with_receipt":
            try:
                data = verify_receipt(self.rpc, receipt, self.service_address)["receipt"]
            except Exception:
                data = None
            # Proof only for this payment: its transaction and its quote.
            if (
                data
                and data.get("transaction") == payment["signature"]
                and data.get("id") == payment["quote_id"]
            ):
                return {"status": "already_paid", **base, "receipt": receipt, "receipt_data": data}

        evidence = {
            "settlement": settlement,
            "receipt": "invalid" if settlement == "quote_expired_with_receipt" else None,
            **chain_evidence(self.rpc, payment["signature"], payment["last_valid_block_height"]),
        }
        decision = decide_retry(evidence)
        if decision not in ("already_paid", "not_paid"):
            raise M2mError(
                "PAYMENT_STATUS_UNKNOWN",
                f"The status of payment {payment['signature']} could not be determined "
                f"(seller: {settlement}, chain: {evidence['signature_status']}, blockhash expired: "
                f"{evidence['blockhash_expired']}). Do not pay again; repeat the request later.",
            )
        return {"status": decision, **base}

    def _send_payment(self, key: str, payment: dict, method: str, url: str, kwargs: dict):
        headers = {**(kwargs.get("headers") or {}), PAYMENT_SIGNATURE: payment["header"]}
        # A network error keeps the payment pending: the next attempt resends it.
        response = self.http.request(method, url, **{**kwargs, "headers": headers})
        outcome = self._resolve(payment, response)
        del self._pending[key]
        _outcomes[response] = outcome
        return response

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        key = request_key(self.http.build_request(method, url, **kwargs))
        with self._lock:
            flight = self._inflight.get(key)
            owner = flight is None
            if owner:
                flight = {"done": threading.Event(), "response": None, "error": None}
                self._inflight[key] = flight
        if not owner:
            flight["done"].wait()
            if flight["error"] is not None:
                raise flight["error"]
            return flight["response"]
        try:
            flight["response"] = self._attempt(key, method, url, kwargs)
            return flight["response"]
        except BaseException as error:
            flight["error"] = error
            raise
        finally:
            with self._lock:
                del self._inflight[key]
            flight["done"].set()

    def _attempt(self, key: str, method: str, url: str, kwargs: dict) -> httpx.Response:
        if key in self._pending:
            return self._send_payment(key, self._pending[key], method, url, kwargs)

        response = self.http.request(method, url, **kwargs)
        header = response.headers.get(PAYMENT_REQUIRED)
        if response.status_code != 402 or not header:
            return response
        payment = self._sign(decode_header(header))
        if payment is None:
            return response
        self._pending[key] = payment
        return self._send_payment(key, payment, method, url, kwargs)

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
        # A signed payload unlocks the resource only once (section K). A repeat gets its receipt
        # back as proof of the original payment, never the resource.
        if settlement.get("replayed"):
            repeated = {
                "success": False,
                "errorReason": "QUOTE_EXPIRED",
                "transaction": settlement["signature"],
                "network": self.network,
                "payer": payer,
                "extensions": {"m2m-receipt": {"info": {"receipt": settlement["receipt"]}}},
            }
            return PaywallOutcome(
                paid=False,
                status=402,
                headers={
                    PAYMENT_RESPONSE: encode_header(repeated),
                    "content-type": "application/json",
                },
                body=json.dumps(
                    {
                        "error": {
                            "code": "QUOTE_EXPIRED",
                            "message": "This payment was already used.",
                        }
                    }
                ).encode(),
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
            # A payment already on-chain is a replay: never broadcast it again, return its receipt.
            existing = verify_split_transaction(transaction, split_expectation(quote), signed=True)
            statuses = self.rpc.call(
                "getSignatureStatuses",
                [[existing["signature"]], {"searchTransactionHistory": True}],
            )
            if statuses["value"][0]:
                settlement = self.api.report_payment(quote, existing["signature"])
                return {**settlement, "replayed": True}, existing["payer"]
            verified = verify_payment(self.rpc, quote, transaction, service)
            signature = submit_payment(self.rpc, transaction)
            return self.api.report_payment(quote, signature), verified["payer"]
        # The relay simulates, enforces expiry and single use, and answers retries idempotently.
        if not verify_quote(quote, service):
            raise M2mError("QUOTE_INVALID")
        verified = verify_split_transaction(transaction, split_expectation(quote), signed=True)
        return self.api.relay_payment(quote, transaction, payment_id), verified["payer"]
