"""Signed quotes (sections C, F, G, K; D1, D7)."""

import json

from solders.pubkey import Pubkey
from solders.signature import Signature

from .constants import NETWORKS, allowed_mint
from .errors import M2mError
from .fees import agent_fee, apply_discounts, fee_in_token_units

QUOTE_FIELDS = (
    "amount",
    "decimals",
    "discount",
    "expires_at",
    "fee_gross",
    "fee_net",
    "id",
    "mint",
    "network",
    "nonce",
    "payee",
    "payee_amount",
    "referral",
    "treasury",
    "usdc_decimals",
    "usdc_mint",
)


def price_split(amount: int, decimals: int, referred: bool = False, credits: int = 0) -> dict:
    """Fee, discounts and the payee's net amount (amount - fee_net, D1)."""
    breakdown = apply_discounts(agent_fee(amount, decimals), referred, credits)
    return {
        **breakdown,
        "payee_amount": amount - fee_in_token_units(breakdown["fee_net"], decimals),
    }


def quote_message(quote: dict) -> str:
    """Canonical form the service signs: JSON with keys sorted and no whitespace."""
    return json.dumps(
        {k: quote[k] for k in QUOTE_FIELDS}, separators=(",", ":"), ensure_ascii=False
    )


def verify_quote(quote: dict, service_address: str) -> bool:
    try:
        signature = Signature.from_string(quote["signature"])
        return signature.verify(
            Pubkey.from_string(service_address), quote_message(quote).encode("utf-8")
        )
    except (ValueError, KeyError, TypeError):
        return False


def assert_quote_fresh(quote: dict, now_seconds: int) -> None:
    if now_seconds > quote["expires_at"]:
        raise M2mError("QUOTE_EXPIRED")


def assert_quote_valid(quote: dict, service_address: str, now_seconds: int) -> None:
    """Service signature, expiry, the network's treasury and USDC mint, and the whitelist."""
    if not verify_quote(quote, service_address):
        raise M2mError("QUOTE_INVALID")
    assert_quote_fresh(quote, now_seconds)
    network = NETWORKS.get(quote["network"])
    if (
        not network
        or not network.get("treasury")
        or quote["treasury"] != network["treasury"]
        or quote["usdc_mint"] != network["usdc"]
    ):
        raise M2mError(
            "QUOTE_INVALID", "The quote does not use this network's treasury or USDC mint."
        )
    if not allowed_mint(quote["network"], quote["mint"]):
        raise M2mError("MINT_NOT_ALLOWED")


def split_expectation(quote: dict) -> dict:
    """What the payee checks the payer's transaction against (section G, step 3)."""
    return {
        "network": quote["network"],
        "payee": quote["payee"],
        "treasury": quote["treasury"],
        "payment_mint": quote["mint"],
        "payment_decimals": quote["decimals"],
        "usdc_decimals": quote["usdc_decimals"],
        "payee_amount": int(quote["payee_amount"]),
        "fee_net": int(quote["fee_net"]),
        "receipt_id": quote["id"],
    }
