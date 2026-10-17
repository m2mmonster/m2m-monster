"""m2m.monster Python SDK: non-custodial agent-to-agent payments over x402 (m2m-split) on Solana.

Agents keep their own keys and sign locally; m2m.monster holds no agents' keys or funds and never
signs or pays payment transactions.
"""

from .api import ApiClient
from .constants import DEVNET, MAINNET, NETWORKS, allowed_mint
from .errors import ERRORS, M2mError
from .fees import agent_fee, apply_discounts
from .payment import (
    pay_quote,
    prepare_payment,
    prepare_refund,
    submit_payment,
    verify_payment,
)
from .quote import assert_quote_valid, price_split, split_expectation, verify_quote
from .receipt import verify_receipt, verify_receipt_signature
from .retry import decide_retry
from .rpc import Rpc
from .split import build_split_transaction, sign_transaction, verify_split_transaction
from .x402 import PaymentClient, Paywall, PaywallOutcome, payment_outcome, settlement_of

__all__ = [
    "DEVNET",
    "ERRORS",
    "MAINNET",
    "NETWORKS",
    "ApiClient",
    "M2mError",
    "PaymentClient",
    "Paywall",
    "PaywallOutcome",
    "Rpc",
    "agent_fee",
    "allowed_mint",
    "apply_discounts",
    "assert_quote_valid",
    "build_split_transaction",
    "pay_quote",
    "prepare_payment",
    "prepare_refund",
    "price_split",
    "decide_retry",
    "payment_outcome",
    "settlement_of",
    "sign_transaction",
    "split_expectation",
    "submit_payment",
    "verify_payment",
    "verify_quote",
    "verify_receipt",
    "verify_receipt_signature",
    "verify_split_transaction",
]
