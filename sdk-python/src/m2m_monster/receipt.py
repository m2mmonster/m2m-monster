"""Verifiable receipts (sections 0, C, G; D14): compact JWS (EdDSA) signed by the service key."""

import base64
import json

from solders.pubkey import Pubkey
from solders.signature import Signature

from .errors import M2mError
from .rpc import Rpc, fetch_confirmed_transaction
from .split import verify_split_transaction


def _b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verify_receipt_signature(jws: str, service_address: str) -> dict:
    """Checks the service signature of a receipt JWS and returns its payload."""
    parts = jws.split(".")
    if len(parts) != 3:
        raise M2mError("RECEIPT_INVALID")
    header, payload, signature = parts
    try:
        if json.loads(_b64url_decode(header)).get("alg") != "EdDSA":
            raise ValueError
        sig = Signature.from_bytes(_b64url_decode(signature))
        if not sig.verify(Pubkey.from_string(service_address), f"{header}.{payload}".encode()):
            raise ValueError
        return json.loads(_b64url_decode(payload))
    except (ValueError, TypeError) as e:
        raise M2mError("RECEIPT_INVALID") from e


def verify_receipt(rpc: Rpc, jws: str, service_address: str) -> dict:
    """Service signature, and the confirmed transaction matches the receipt (verify_receipt)."""
    receipt = verify_receipt_signature(jws, service_address)
    confirmed = fetch_confirmed_transaction(rpc, receipt["transaction"])
    if not confirmed:
        raise M2mError("RECEIPT_INVALID", "The receipt transaction is not on-chain.")
    expected = {
        "network": receipt["network"],
        "payee": receipt["payee"],
        "treasury": receipt["treasury"],
        "payment_mint": receipt["mint"],
        "payment_decimals": receipt["decimals"],
        "usdc_decimals": receipt["usdc_decimals"],
        "payee_amount": int(receipt["payee_amount"]),
        "fee_net": int(receipt["fee_net"]),
        "receipt_id": receipt["id"],
    }
    try:
        verified = verify_split_transaction(confirmed["wire"], expected, signed=True)
    except M2mError as e:
        raise M2mError(
            "RECEIPT_INVALID", "The on-chain transaction does not match the receipt."
        ) from e
    if verified["payer"] != receipt["payer"] or verified["signature"] != receipt["transaction"]:
        raise M2mError("RECEIPT_INVALID", "The on-chain transaction does not match the receipt.")
    return {"receipt": receipt, "slot": confirmed["slot"]}
