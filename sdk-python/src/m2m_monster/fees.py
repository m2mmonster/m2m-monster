"""Agent-to-agent fee (section F) and referral discounts (section C; D3, D4, D6).

Money is always integers in base units; never floating point.
"""

from .constants import AGENT_FEE, MIN_PAYMENT, REFERRAL, USD_UNITS
from .errors import M2mError


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def agent_fee(amount: int, decimals: int) -> int:
    """Fee in USDC base units for `amount` base units of a 1-USD token. Rounded up."""
    scale = 10**decimals
    if amount * USD_UNITS < MIN_PAYMENT * scale:
        raise M2mError("PAYMENT_BELOW_MINIMUM")
    fee = _ceil_div(amount * USD_UNITS * AGENT_FEE["rate_bps"], 10_000 * scale)
    return min(max(fee, AGENT_FEE["min"]), AGENT_FEE["max"])


def apply_discounts(fee_gross: int, referred: bool, credits: int) -> dict:
    """Referred discount first, then credits, never above 50% of the gross fee (rounded down)."""
    cap = fee_gross * REFERRAL["max_combined_discount_percent"] // 100
    referred_discount = fee_gross * REFERRAL["referred_discount_percent"] // 100 if referred else 0
    credits_used = min(credits, cap - referred_discount)
    discount = referred_discount + credits_used
    return {
        "fee_gross": fee_gross,
        "discount": discount,
        "credits_used": credits_used,
        "fee_net": fee_gross - discount,
    }


def referral_credit(fee_net: int) -> int:
    """Credit earned by the referrer from a fee paid by its referred agent (D4)."""
    return fee_net * REFERRAL["credit_percent"] // 100


def fee_in_token_units(fee_net: int, decimals: int) -> int:
    """A fee in USDC base units expressed in base units of a 1-USD token, rounded up."""
    return _ceil_div(fee_net * 10**decimals, USD_UNITS)
