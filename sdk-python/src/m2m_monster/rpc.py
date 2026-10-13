"""Solana JSON-RPC steps shared by payer and payee (sections G, K).

The RPC only reads, simulates and broadcasts transactions that are already signed.
"""

import base64
import json
import time

import httpx

from .constants import MAX_COMPUTE_UNIT_PRICE, TOKEN_PROGRAM
from .errors import M2mError
from .split import associated_token_account


class Rpc:
    """Minimal JSON-RPC client. Retries HTTP 429 with backoff."""

    def __init__(self, url: str, client: httpx.Client | None = None, retries: int = 6) -> None:
        self.url = url
        self.client = client or httpx.Client(timeout=30)
        self.retries = retries

    def call(self, method: str, params: list):
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        for attempt in range(self.retries + 1):
            response = self.client.post(self.url, json=body)
            if response.status_code == 429 and attempt < self.retries:
                time.sleep(0.5 * 2**attempt)
                continue
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise RuntimeError(f"RPC {method} failed: {payload['error']}")
            return payload["result"]
        raise RuntimeError(f"RPC {method} kept answering 429")

    def account(self, address: str) -> tuple[str, bytes] | None:
        value = self.call(
            "getAccountInfo", [address, {"encoding": "base64", "commitment": "confirmed"}]
        )["value"]
        return (value["owner"], base64.b64decode(value["data"][0])) if value else None

    def latest_blockhash(self) -> tuple[str, int]:
        value = self.call("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]
        return value["blockhash"], value["lastValidBlockHeight"]


def token_balance(rpc: Rpc, owner: str, mint: str) -> int | None:
    """Balance of the owner's associated token account, or None if it does not exist."""
    account = rpc.account(associated_token_account(owner, mint))
    if not account or account[0] != TOKEN_PROGRAM or len(account[1]) < 72:
        return None
    return int.from_bytes(account[1][64:72], "little")


def mint_decimals(rpc: Rpc, mint: str) -> int:
    """Decimals read from the mint account on-chain; never hard-coded (section E, D19)."""
    account = rpc.account(mint)
    if not account or account[0] != TOKEN_PROGRAM or len(account[1]) < 45:
        raise M2mError("MINT_NOT_ALLOWED")
    return account[1][44]


def estimate_compute_unit_price(
    rpc: Rpc, writable: list[str], cap: int = MAX_COMPUTE_UNIT_PRICE
) -> int:
    """75th percentile of recent non-zero prioritization fees, clamped to the cap (D16)."""
    fees = sorted(
        f["prioritizationFee"]
        for f in rpc.call("getRecentPrioritizationFees", [writable])
        if f["prioritizationFee"] > 0
    )
    estimate = fees[int((len(fees) - 1) * 0.75)] if fees else 0
    return min(estimate, cap, MAX_COMPUTE_UNIT_PRICE)


def simulate(rpc: Rpc, wire: str, *, sig_verify: bool) -> int:
    """Simulates a wire transaction and returns the compute units consumed (section K)."""
    config = {"encoding": "base64", "commitment": "confirmed"}
    config |= {"sigVerify": True} if sig_verify else {"replaceRecentBlockhash": True}
    value = rpc.call("simulateTransaction", [wire, config])["value"]
    if value.get("err") or value.get("unitsConsumed") is None:
        logs = " | ".join((value.get("logs") or [])[-5:])
        detail = json.dumps(value.get("err"))
        raise M2mError(
            "SIMULATION_FAILED",
            f"Transaction simulation failed: {detail}" + (f" — {logs}" if logs else ""),
        )
    return value["unitsConsumed"]


def submit_and_confirm(
    rpc: Rpc,
    wire: str,
    *,
    last_valid_block_height: int | None = None,
    timeout: float = 90,
    poll: float = 1,
) -> str:
    """Broadcasts an already fully signed transaction and waits for confirmation (rule 3)."""
    send = [wire, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}]
    signature = rpc.call("sendTransaction", send)
    deadline = time.monotonic() + timeout
    resent = time.monotonic()
    while time.monotonic() < deadline:
        status = rpc.call("getSignatureStatuses", [[signature]])["value"][0]
        if status and status.get("err"):
            raise M2mError(
                "TRANSACTION_FAILED", f"Transaction failed on-chain: {json.dumps(status['err'])}"
            )
        if status and status.get("confirmationStatus") in ("confirmed", "finalized"):
            return signature
        if last_valid_block_height is not None:
            height = rpc.call("getBlockHeight", [{"commitment": "confirmed"}])
            if height > last_valid_block_height:
                break
        # Re-broadcast the same signed bytes; this can never create a second payment.
        if time.monotonic() - resent > 2:
            try:
                rpc.call("sendTransaction", send)
            except Exception:
                pass
            resent = time.monotonic()
        time.sleep(poll)
    raise M2mError(
        "TRANSACTION_FAILED", "The transaction was not confirmed before its blockhash expired."
    )


def fetch_confirmed_transaction(rpc: Rpc, signature: str) -> dict | None:
    """A confirmed transaction as {wire, slot, block_time}, or None."""
    tx = rpc.call(
        "getTransaction",
        [
            signature,
            {"encoding": "base64", "commitment": "confirmed", "maxSupportedTransactionVersion": 0},
        ],
    )
    if not tx:
        return None
    if tx.get("meta", {}).get("err"):
        raise M2mError(
            "TRANSACTION_FAILED", f"Transaction failed on-chain: {json.dumps(tx['meta']['err'])}"
        )
    return {"wire": tx["transaction"][0], "slot": tx["slot"], "block_time": tx.get("blockTime")}
