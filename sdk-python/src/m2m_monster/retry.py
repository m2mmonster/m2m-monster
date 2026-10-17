"""Retrying a payment without paying twice (section K; D54, D66).

The payer keeps each signed payment until its outcome is known and decides from evidence: the
seller's answer, a verified receipt and the transaction's status on-chain. `decide_retry` is the
same pure decision as the TypeScript SDK, proven by spec/test-vectors/retry.json.
"""

import hashlib

import httpx

from .rpc import Rpc


def decide_retry(evidence: dict) -> str:
    """Returns "paid", "already_paid", "not_paid" or "unknown" (never pay again)."""
    settlement = evidence["settlement"]
    status = evidence.get("signature_status")
    if settlement == "success":
        return "paid"
    if settlement == "quote_expired_with_receipt" and evidence.get("receipt") == "valid":
        return "already_paid"
    if status in ("confirmed", "finalized"):
        return "already_paid"
    # A failed transaction moved no tokens and can never execute again.
    if status == "failed":
        return "not_paid"
    # Not paid only with proof that it did not land and that it never can.
    if status == "not_found" and evidence.get("blockhash_expired") is True:
        return "not_paid"
    return "unknown"


def chain_evidence(rpc: Rpc, signature: str, last_valid_block_height: int) -> dict:
    """Chain evidence for a signed payment (D66, D67), as in the TypeScript SDK.

    The blockhash first: getEpochInfo at finalized gives the finalized block height and its slot
    in one answer. Then the signature status, searching the history. "Not found" counts only if
    that answer was evaluated at or after the finalized slot seen before (a lagging node behind a
    load balancer could miss the transaction). Malformed answers count as RPC errors.
    """
    blockhash_expired: bool | str = "rpc_error"
    finalized_slot = None
    try:
        info = rpc.call("getEpochInfo", [{"commitment": "finalized"}])
        height, slot = info.get("blockHeight"), info.get("absoluteSlot")
        if isinstance(height, int) and isinstance(slot, int):
            blockhash_expired = height > last_valid_block_height
            finalized_slot = slot
    except Exception:
        pass
    signature_status = "rpc_error"
    try:
        answer = rpc.call("getSignatureStatuses", [[signature], {"searchTransactionHistory": True}])
        status = answer["value"][0]
        context_slot = (answer.get("context") or {}).get("slot")
        if status is None:
            if isinstance(context_slot, int) and (
                finalized_slot is None or context_slot >= finalized_slot
            ):
                signature_status = "not_found"
        elif isinstance(status, dict):
            if status.get("err"):
                signature_status = "failed"
            elif status.get("confirmationStatus") in ("finalized", "confirmed"):
                signature_status = status["confirmationStatus"]
            else:
                signature_status = "processed"
    except Exception:
        pass
    return {"signature_status": signature_status, "blockhash_expired": blockhash_expired}


def request_key(request: httpx.Request) -> str:
    """Binds a payment to its request: the Idempotency-Key header, else method, URL and body."""
    explicit = request.headers.get("idempotency-key")
    if explicit:
        return f"idempotency-key:{explicit}"
    digest = hashlib.sha256(request.read()).hexdigest()
    return f"{request.method} {request.url} {digest}"
