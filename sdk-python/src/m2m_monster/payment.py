"""Payer and payee steps (section G, steps 2-4; section K) and refunds (D10).

Everything here builds, checks or simulates. Only `pay_quote` and `sign_transaction` sign, with
the caller's own key, locally.
"""

import time

from solders.keypair import Keypair

from .constants import MAX_COMPUTE_UNIT_PRICE, REFUND_MEMO_PREFIX, TOKEN_PROGRAM
from .errors import M2mError
from .quote import assert_quote_valid, split_expectation
from .rpc import Rpc, estimate_compute_unit_price, simulate, submit_and_confirm, token_balance
from .split import (
    associated_token_account,
    build_split_transaction,
    compile_v0,
    compute_budget,
    memo,
    sign_transaction,
    unsigned_wire,
    verify_split_transaction,
)

PROVISIONAL_COMPUTE_UNIT_LIMIT = 1_400_000


def build_simulated(rpc: Rpc, writable: list[str], max_compute_unit_price: int, build) -> dict:
    """Simulate at the maximum limit, set the limit to 1.2 x units consumed, simulate again."""
    price = estimate_compute_unit_price(rpc, writable, max_compute_unit_price)
    blockhash, last_valid_block_height = rpc.latest_blockhash()
    consumed = simulate(
        rpc, build(PROVISIONAL_COMPUTE_UNIT_LIMIT, price, blockhash), sig_verify=False
    )
    limit = -(-consumed * 12 // 10)
    transaction = build(limit, price, blockhash)
    simulate(rpc, transaction, sig_verify=False)
    return {
        "transaction": transaction,
        "compute_unit_limit": limit,
        "compute_unit_price": price,
        "last_valid_block_height": last_valid_block_height,
    }


def prepare_payment(
    rpc: Rpc,
    payer: str,
    quote: dict,
    service_address: str,
    *,
    max_compute_unit_price: int = MAX_COMPUTE_UNIT_PRICE,
    now: float | None = None,
) -> dict:
    """Payer side before signing: quote, receiving accounts, USDC for the fee, simulation."""
    assert_quote_valid(quote, service_address, int(now if now is not None else time.time()))
    e = split_expectation(quote)
    usdc = quote["usdc_mint"]
    # Never create accounts inside a payment (section K).
    if (
        token_balance(rpc, e["payee"], e["payment_mint"]) is None
        or token_balance(rpc, e["treasury"], usdc) is None
    ):
        raise M2mError("RECEIVER_TOKEN_ACCOUNT_MISSING")
    # The fee is always paid in USDC; never convert another token to cover it (rule 6).
    if (token_balance(rpc, payer, usdc) or 0) < e["fee_net"]:
        raise M2mError("FEE_BALANCE_INSUFFICIENT_USDC")

    writable = [
        associated_token_account(payer, e["payment_mint"]),
        associated_token_account(e["payee"], e["payment_mint"]),
        associated_token_account(payer, usdc),
        associated_token_account(e["treasury"], usdc),
    ]

    def build(limit: int, price: int, blockhash: str) -> str:
        return build_split_transaction(
            network=e["network"],
            payer=payer,
            payee=e["payee"],
            treasury=e["treasury"],
            payment_mint=e["payment_mint"],
            payment_decimals=e["payment_decimals"],
            usdc_decimals=e["usdc_decimals"],
            payee_amount=e["payee_amount"],
            fee_net=e["fee_net"],
            receipt_id=e["receipt_id"],
            compute_unit_limit=limit,
            compute_unit_price=price,
            blockhash=blockhash,
        )

    return build_simulated(rpc, writable, max_compute_unit_price, build)


def pay_quote(rpc: Rpc, keypair: Keypair, quote: dict, service_address: str, **kwargs) -> dict:
    """Builds, simulates and signs the m2m-split locally. The key never leaves this process."""
    prepared = prepare_payment(rpc, str(keypair.pubkey()), quote, service_address, **kwargs)
    return {**prepared, "transaction": sign_transaction(prepared["transaction"], keypair)}


def verify_payment(
    rpc: Rpc, quote: dict, transaction: str, service_address: str, *, now: float | None = None
) -> dict:
    """Payee side: quote checks, strict layout with the payer signature, signed simulation."""
    assert_quote_valid(quote, service_address, int(now if now is not None else time.time()))
    verified = verify_split_transaction(transaction, split_expectation(quote), signed=True)
    simulate(rpc, transaction, sig_verify=True)
    return verified


def submit_payment(rpc: Rpc, transaction: str) -> str:
    """Broadcasts the verified, payer-signed transaction and waits for confirmation."""
    return submit_and_confirm(rpc, transaction)


def prepare_refund(
    rpc: Rpc, receipt: dict, amount: int, *, max_compute_unit_price: int = MAX_COMPUTE_UNIT_PRICE
) -> dict:
    """Unsigned refund payee -> payer for a verified receipt. No fee; the payee signs (D10)."""
    if amount <= 0 or amount > int(receipt["amount"]):
        raise M2mError(
            "INVALID_REQUEST", "The refund amount must be positive and at most the original amount."
        )
    payee, payer, mint = receipt["payee"], receipt["payer"], receipt["mint"]
    if token_balance(rpc, payer, mint) is None:
        raise M2mError("RECEIVER_TOKEN_ACCOUNT_MISSING")
    source = associated_token_account(payee, mint)
    destination = associated_token_account(payer, mint)
    data = bytes([12]) + amount.to_bytes(8, "little") + bytes([receipt["decimals"]])
    transfer = (
        TOKEN_PROGRAM,
        [
            (source, False, True),
            (mint, False, False),
            (destination, False, True),
            (payee, True, False),
        ],
        data,
    )

    def build(limit: int, price: int, blockhash: str) -> str:
        instructions = [
            *compute_budget(limit, price),
            transfer,
            memo(f"{REFUND_MEMO_PREFIX} {receipt['id']}"),
        ]
        return unsigned_wire(compile_v0(payee, instructions, blockhash))

    return build_simulated(rpc, [source, destination], max_compute_unit_price, build)
