"""HTTP client for the m2m.monster API over the client generated from spec/openapi.json."""

from typing import Any

from solders.keypair import Keypair

from ._api.api.default import (
    get_pricing_json,
    get_status_json,
    get_v1_agents_me_receipts,
    get_v1_agents_me_referrals,
    get_v1_receipts_id,
    get_v1_service_key,
    post_v1_agents_challenge,
    post_v1_agents_register,
    post_v1_payments,
    post_v1_payments_build,
    post_v1_payments_verify,
    post_v1_quotes,
    post_v1_receipts,
    post_v1_receipts_verify,
    post_v1_refunds_build,
)
from ._api.client import AuthenticatedClient, Client
from ._api.models import (
    Error,
    PostV1AgentsChallengeBody,
    PostV1AgentsRegisterBody,
    PostV1PaymentsBody,
    PostV1PaymentsBuildBody,
    PostV1PaymentsVerifyBody,
    PostV1ReceiptsBody,
    PostV1ReceiptsVerifyBody,
    PostV1RefundsBuildBody,
    Quote,
    QuoteRequest,
)
from ._api.types import UNSET
from .errors import M2mError
from .referrals import registration_message


class ApiClient:
    """Calls the /v1 API. `api_key` (optional registration) unlocks discounts and history."""

    def __init__(
        self, base_url: str, api_key: str | None = None, httpx_args: dict | None = None
    ) -> None:
        args = {"base_url": base_url.rstrip("/"), "httpx_args": httpx_args or {}}
        self._client = AuthenticatedClient(token=api_key, **args) if api_key else Client(**args)
        self._service_address: str | None = None

    @staticmethod
    def _ok(response) -> Any:
        parsed = response.parsed
        if (
            200 <= response.status_code < 300
            and parsed is not None
            and not isinstance(parsed, Error)
        ):
            return parsed.to_dict()
        if isinstance(parsed, Error):
            raise M2mError(parsed.error.code.value, parsed.error.message)
        raise M2mError("INTERNAL_ERROR", f"Unexpected API response {response.status_code}")

    def request_quote(
        self, network: str, mint: str, amount: int | str, payee: str, idempotency_key: str
    ) -> dict:
        """Signed 30-second quote. Reuse the same idempotency key when retrying (section K)."""
        body = QuoteRequest(network=network, mint=mint, amount=str(amount), payee=payee)
        return self._ok(
            post_v1_quotes.sync_detailed(
                client=self._client, body=body, idempotency_key=idempotency_key
            )
        )

    def relay_payment(self, quote: dict, transaction: str, idempotency_key: str) -> dict:
        """Broadcasts a payer-signed transaction through the relay; returns the receipt."""
        body = PostV1PaymentsBody(quote=Quote.from_dict(quote), transaction=transaction)
        return self._ok(
            post_v1_payments.sync_detailed(
                client=self._client, body=body, idempotency_key=idempotency_key
            )
        )

    def report_payment(self, quote: dict, signature: str) -> dict:
        body = PostV1ReceiptsBody(quote=Quote.from_dict(quote), signature=signature)
        return self._ok(post_v1_receipts.sync_detailed(client=self._client, body=body))

    def get_receipt(self, receipt_id: str) -> dict:
        return self._ok(get_v1_receipts_id.sync_detailed(receipt_id, client=self._client))

    def verify_receipt(self, receipt: str) -> dict:
        body = PostV1ReceiptsVerifyBody(receipt=receipt)
        return self._ok(post_v1_receipts_verify.sync_detailed(client=self._client, body=body))

    def build_payment(self, quote: dict, payer: str) -> dict:
        body = PostV1PaymentsBuildBody(quote=Quote.from_dict(quote), payer=payer)
        return self._ok(post_v1_payments_build.sync_detailed(client=self._client, body=body))

    def verify_payment(self, quote: dict, transaction: str) -> dict:
        body = PostV1PaymentsVerifyBody(quote=Quote.from_dict(quote), transaction=transaction)
        return self._ok(post_v1_payments_verify.sync_detailed(client=self._client, body=body))

    def build_refund(self, receipt: str, amount: int | str) -> dict:
        body = PostV1RefundsBuildBody(receipt=receipt, amount=str(amount))
        return self._ok(post_v1_refunds_build.sync_detailed(client=self._client, body=body))

    def pricing(self) -> dict:
        return self._ok(get_pricing_json.sync_detailed(client=self._client))

    def status(self) -> dict:
        return self._ok(get_status_json.sync_detailed(client=self._client))

    def register(
        self,
        keypair: Keypair,
        agent_id: str,
        capabilities: list[str] | None = None,
        referred_by: str | None = None,
    ) -> dict:
        """Optional registration (section D): signs the challenge locally with the agent's key."""
        pubkey = str(keypair.pubkey())
        challenge = self._ok(
            post_v1_agents_challenge.sync_detailed(
                client=self._client, body=PostV1AgentsChallengeBody(solana_pubkey=pubkey)
            )
        )
        signature = keypair.sign_message(
            registration_message(pubkey, challenge["nonce"]).encode("utf-8")
        )
        body = PostV1AgentsRegisterBody(
            agent_id=agent_id,
            solana_pubkey=pubkey,
            signature=str(signature),
            capabilities=capabilities if capabilities is not None else UNSET,
            referred_by=referred_by if referred_by is not None else UNSET,
        )
        return self._ok(post_v1_agents_register.sync_detailed(client=self._client, body=body))

    def referral_status(self) -> dict:
        return self._ok(get_v1_agents_me_referrals.sync_detailed(client=self._client))

    def receipt_history(self, limit: int = 50, before: int | None = None) -> dict:
        return self._ok(
            get_v1_agents_me_receipts.sync_detailed(
                client=self._client, limit=limit, before=before if before is not None else UNSET
            )
        )

    def service_address(self) -> str:
        """Address of the key that signs quotes and receipts; fetched once and cached."""
        if self._service_address is None:
            self._service_address = self._ok(get_v1_service_key.sync_detailed(client=self._client))[
                "address"
            ]
        return self._service_address
