"""Devnet integration against the deployed sandbox: uv run pytest -m devnet

Needs the funded test keys in ../.env (DEVNET_PAYER_KEY, DEVNET_PAYEE_KEY, SOLANA_RPC_URL).
SANDBOX_URL defaults to https://sandbox.m2m.monster. Tests never use real funds (rule 11).
"""

import os
import uuid
from pathlib import Path

import httpx
import pytest
from solders.keypair import Keypair

from m2m_monster import (
    DEVNET,
    NETWORKS,
    ApiClient,
    M2mError,
    PaymentClient,
    Paywall,
    Rpc,
    pay_quote,
    settlement_of,
    submit_payment,
    verify_payment,
    verify_receipt,
)
from m2m_monster.rpc import token_balance

pytestmark = pytest.mark.devnet


def _env() -> dict:
    values = {}
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        pytest.skip("Devnet tests need the test keys in ../.env", allow_module_level=True)
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


ENV = _env()
USDC = NETWORKS[DEVNET]["usdc"]
TREASURY = NETWORKS[DEVNET]["treasury"]
RPC = Rpc(ENV["SOLANA_RPC_URL"])
API = ApiClient(os.environ.get("SANDBOX_URL", "https://sandbox.m2m.monster"))
PAYER = Keypair.from_base58_string(ENV["DEVNET_PAYER_KEY"])
PAYEE = Keypair.from_base58_string(ENV["DEVNET_PAYEE_KEY"])
SERVICE = API.service_address()


def balances() -> dict:
    return {
        "payee": token_balance(RPC, str(PAYEE.pubkey()), USDC) or 0,
        "treasury": token_balance(RPC, TREASURY, USDC) or 0,
    }


def quote(amount: str) -> dict:
    return API.request_quote(DEVNET, USDC, amount, str(PAYEE.pubkey()), f"py-{uuid.uuid4()}")


def test_payee_submits_itself_and_reports_for_a_receipt():
    before = balances()
    q = quote("100000")
    paid = pay_quote(RPC, PAYER, q, SERVICE)
    verify_payment(RPC, q, paid["transaction"], SERVICE)
    signature = submit_payment(RPC, paid["transaction"])
    settled = API.report_payment(q, signature)
    assert settled["receipt_data"]["fee_net"] == "1000"
    assert verify_receipt(RPC, settled["receipt"], SERVICE)["receipt"]["id"] == q["id"]
    after = balances()
    assert after["payee"] - before["payee"] == 99_000
    assert after["treasury"] - before["treasury"] == 1_000


def test_relay_settles_once():
    before = balances()
    q = quote("200000")
    paid = pay_quote(RPC, PAYER, q, SERVICE)
    key = f"py-{uuid.uuid4()}"
    settled = API.relay_payment(q, paid["transaction"], key)
    again = API.relay_payment(q, paid["transaction"], key)
    # Same payment, flagged as a repeat (D54): same signature and receipt, never a second payment.
    assert settled.get("replayed") is False and again.get("replayed") is True
    assert {**again, "replayed": False} == settled
    after = balances()
    assert after["payee"] - before["payee"] == 199_000
    assert after["treasury"] - before["treasury"] == 1_000


def test_x402_request_402_pay_200():
    paywall = Paywall(API, RPC, DEVNET, str(PAYEE.pubkey()))

    def handler(request: httpx.Request) -> httpx.Response:
        outcome = paywall.handle(
            request.headers, str(request.url), {"mint": USDC, "amount": "50000"}
        )
        if not outcome.paid:
            return httpx.Response(outcome.status, headers=outcome.headers, content=outcome.body)
        return httpx.Response(200, json={"paid": True}, headers=outcome.headers)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = PaymentClient(RPC, PAYER, SERVICE, network=DEVNET, http=http)
    res = client.get("https://agent.test/resource")
    assert res.status_code == 200
    assert settlement_of(res)["success"] is True


def test_no_usdc_for_the_fee():
    with pytest.raises(M2mError) as e:
        pay_quote(RPC, Keypair(), quote("100000"), SERVICE)
    assert e.value.code == "FEE_BALANCE_INSUFFICIENT_USDC"
