"""Payer, payee, refund and receipt steps against an in-memory RPC (sections G, K)."""

import base64

import pytest
from fakes import PAYEE, PAYER, SERVICE, TREASURY, USDC, funded_rpc, jws, signature_of, signed_quote
from solders.transaction import VersionedTransaction

from m2m_monster.constants import MAX_COMPUTE_UNIT_PRICE
from m2m_monster.errors import M2mError
from m2m_monster.payment import pay_quote, prepare_payment, prepare_refund, verify_payment
from m2m_monster.quote import split_expectation
from m2m_monster.receipt import verify_receipt, verify_receipt_signature
from m2m_monster.split import verify_split_transaction

SERVICE_ADDRESS = str(SERVICE.pubkey())


def code_of(fn, *args, **kwargs) -> str:
    with pytest.raises(M2mError) as e:
        fn(*args, **kwargs)
    return e.value.code


def test_prepare_returns_unsigned_and_simulates():
    rpc, quote = funded_rpc(), signed_quote()
    prepared = prepare_payment(rpc, str(PAYER.pubkey()), quote, SERVICE_ADDRESS)
    tx = VersionedTransaction.from_bytes(base64.b64decode(prepared["transaction"]))
    assert str(tx.signatures[0]) == "1" * 64
    assert prepared["compute_unit_limit"] == 7200
    assert all(s.get("replaceRecentBlockhash") for s in rpc.simulated)
    verify_split_transaction(prepared["transaction"], split_expectation(quote), signed=False)


def test_priority_fee_is_capped():
    rpc = funded_rpc()
    rpc.fees = [MAX_COMPUTE_UNIT_PRICE * 3]
    prepared = prepare_payment(rpc, str(PAYER.pubkey()), signed_quote(), SERVICE_ADDRESS)
    assert prepared["compute_unit_price"] == MAX_COMPUTE_UNIT_PRICE


def test_payer_checks():
    payer = str(PAYER.pubkey())
    rpc = funded_rpc()
    tampered = {**signed_quote(), "fee_net": "1"}
    assert code_of(prepare_payment, rpc, payer, tampered, SERVICE_ADDRESS) == "QUOTE_INVALID"
    expired = signed_quote(expires_at=1)
    assert code_of(prepare_payment, rpc, payer, expired, SERVICE_ADDRESS) == "QUOTE_EXPIRED"
    other = signed_quote(treasury=str(PAYEE.pubkey()))
    assert code_of(prepare_payment, rpc, payer, other, SERVICE_ADDRESS) == "QUOTE_INVALID"

    rpc = funded_rpc()
    rpc.put_token(payer, USDC, 24_999)
    code = code_of(prepare_payment, rpc, payer, signed_quote(), SERVICE_ADDRESS)
    assert code == "FEE_BALANCE_INSUFFICIENT_USDC"

    rpc = funded_rpc()
    rpc.accounts.clear()
    rpc.put_token(payer, USDC, 20_000_000)
    code = code_of(prepare_payment, rpc, payer, signed_quote(), SERVICE_ADDRESS)
    assert code == "RECEIVER_TOKEN_ACCOUNT_MISSING"

    rpc = funded_rpc()
    rpc.simulation = {"err": {"InstructionError": [2, {"Custom": 1}]}, "logs": ["no funds"]}
    code = code_of(prepare_payment, rpc, payer, signed_quote(), SERVICE_ADDRESS)
    assert code == "SIMULATION_FAILED"


def test_payee_verifies_signed_payment():
    rpc, quote = funded_rpc(), signed_quote()
    paid = pay_quote(rpc, PAYER, quote, SERVICE_ADDRESS)
    verified = verify_payment(rpc, quote, paid["transaction"], SERVICE_ADDRESS)
    assert verified["payer"] == str(PAYER.pubkey())
    assert rpc.simulated[-1].get("sigVerify") is True

    unsigned = prepare_payment(rpc, str(PAYER.pubkey()), quote, SERVICE_ADDRESS)["transaction"]
    code = code_of(verify_payment, rpc, quote, unsigned, SERVICE_ADDRESS)
    assert code == "PAYMENT_TRANSACTION_INVALID"
    other = signed_quote(id="q_other")
    code = code_of(verify_payment, rpc, other, paid["transaction"], SERVICE_ADDRESS)
    assert code == "PAYMENT_TRANSACTION_INVALID"


def _receipt(transaction: str) -> dict:
    quote = signed_quote()
    return {
        "version": 1,
        "id": quote["id"],
        "network": quote["network"],
        "transaction": signature_of(transaction),
        "payer": str(PAYER.pubkey()),
        "payee": quote["payee"],
        "mint": USDC,
        "decimals": 6,
        "amount": "10000000",
        "payee_amount": "9975000",
        "usdc_mint": USDC,
        "usdc_decimals": 6,
        "treasury": TREASURY,
        "fee_gross": "25000",
        "discount": "0",
        "fee_net": "25000",
        "issued_at": 1,
        "referral": quote["referral"],
    }


def test_receipts():
    rpc = funded_rpc()
    paid = pay_quote(rpc, PAYER, signed_quote(), SERVICE_ADDRESS)
    receipt = _receipt(paid["transaction"])
    token = jws(receipt)
    assert verify_receipt_signature(token, SERVICE_ADDRESS) == receipt
    head, _, sig = token.split(".")
    forged = jws({**receipt, "fee_net": "1"}).split(".")[1]
    code = code_of(verify_receipt_signature, f"{head}.{forged}.{sig}", SERVICE_ADDRESS)
    assert code == "RECEIPT_INVALID"

    assert code_of(verify_receipt, rpc, token, SERVICE_ADDRESS) == "RECEIPT_INVALID"
    rpc.call("sendTransaction", [paid["transaction"]])
    assert verify_receipt(rpc, token, SERVICE_ADDRESS)["slot"] == 7
    mismatch = jws({**receipt, "payee_amount": "1"})
    assert code_of(verify_receipt, rpc, mismatch, SERVICE_ADDRESS) == "RECEIPT_INVALID"


def test_refund_is_unsigned_payee_to_payer_without_fee():
    rpc = funded_rpc()
    paid = pay_quote(rpc, PAYER, signed_quote(), SERVICE_ADDRESS)
    receipt = _receipt(paid["transaction"])
    refund = prepare_refund(rpc, receipt, 5_000_000)
    tx = VersionedTransaction.from_bytes(base64.b64decode(refund["transaction"]))
    keys = [str(k) for k in tx.message.account_keys]
    assert keys[0] == str(PAYEE.pubkey())
    assert tx.message.header.num_required_signatures == 1
    assert str(tx.signatures[0]) == "1" * 64
    assert len(tx.message.instructions) == 4
    assert TREASURY not in keys
    assert code_of(prepare_refund, rpc, receipt, 10_000_001) == "INVALID_REQUEST"
    assert code_of(prepare_refund, rpc, receipt, 0) == "INVALID_REQUEST"
