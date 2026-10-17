"""The shared spec/test-vectors, with the same results as the TypeScript SDK."""

import json
from pathlib import Path

import pytest
from solders.keypair import Keypair

from m2m_monster import constants
from m2m_monster.errors import ERRORS, M2mError
from m2m_monster.fees import agent_fee, apply_discounts, fee_in_token_units, referral_credit
from m2m_monster.quote import quote_message, split_expectation, verify_quote
from m2m_monster.split import build_split_transaction, sign_transaction, verify_split_transaction

VECTORS = Path(__file__).resolve().parents[2] / "spec" / "test-vectors"


def load(name: str) -> dict:
    return json.loads((VECTORS / name).read_text(encoding="utf-8"))


FEES = load("fees.json")
QUOTE = load("quote.json")
SPLIT = load("split.json")
CONSTANTS = load("constants.json")


@pytest.mark.parametrize("v", FEES["fee"], ids=lambda v: v["name"])
def test_agent_fee(v):
    assert agent_fee(int(v["amount"]), v["decimals"]) == int(v["fee_gross"])


@pytest.mark.parametrize("v", FEES["below_minimum"], ids=lambda v: v["name"])
def test_below_minimum(v):
    with pytest.raises(M2mError) as e:
        agent_fee(int(v["amount"]), v["decimals"])
    assert e.value.code == "PAYMENT_BELOW_MINIMUM"


@pytest.mark.parametrize("v", FEES["discount"], ids=lambda v: v["name"])
def test_discounts(v):
    result = apply_discounts(int(v["fee_gross"]), v["referred"], int(v["credits"]))
    assert result == {
        "fee_gross": int(v["fee_gross"]),
        "discount": int(v["discount"]),
        "credits_used": int(v["credits_used"]),
        "fee_net": int(v["fee_net"]),
    }


@pytest.mark.parametrize("v", FEES["credit"], ids=lambda v: v["name"])
def test_referral_credit(v):
    assert referral_credit(int(v["fee_net"])) == int(v["credit"])


@pytest.mark.parametrize("v", FEES["fee_in_token"], ids=lambda v: v["name"])
def test_fee_in_token_units(v):
    assert fee_in_token_units(int(v["fee_net"]), v["decimals"]) == int(v["fee_token"])


def test_quote_message_and_signature():
    quote = QUOTE["quote"]
    assert quote_message(quote) == QUOTE["message"]
    assert verify_quote({**quote, "signature": QUOTE["signature"]}, QUOTE["service_address"])
    tampered = {**quote, "fee_net": "1", "signature": QUOTE["signature"]}
    assert not verify_quote(tampered, QUOTE["service_address"])
    assert not verify_quote({**quote, "signature": "garbage"}, QUOTE["service_address"])


def test_service_key_from_seed():
    service = Keypair.from_seed(bytes([QUOTE["service_seed"]]) * 32)
    assert str(service.pubkey()) == QUOTE["service_address"]


def _params(case: dict) -> dict:
    p = dict(case["params"])
    for k in ("payeeAmount", "feeNet", "computeUnitPrice"):
        p[k] = int(p[k])
    return p


@pytest.mark.parametrize("case", SPLIT["valid"], ids=lambda c: c["name"])
def test_split_layout_bytes(case):
    p = _params(case)
    payer = Keypair.from_seed(bytes([SPLIT["seeds"]["payer"]]) * 32)
    assert str(payer.pubkey()) == p["payer"]
    unsigned = build_split_transaction(
        network=p["network"],
        payer=p["payer"],
        payee=p["payee"],
        treasury=p["treasury"],
        payment_mint=p["paymentMint"],
        payment_decimals=p["paymentDecimals"],
        usdc_decimals=p["usdcDecimals"],
        payee_amount=p["payeeAmount"],
        fee_net=p["feeNet"],
        receipt_id=p["receiptId"],
        compute_unit_limit=p["computeUnitLimit"],
        compute_unit_price=p["computeUnitPrice"],
        blockhash=p["lifetime"]["blockhash"],
    )
    assert unsigned == case["unsigned"]
    signed = sign_transaction(unsigned, payer)
    assert signed == case["signed"]
    verified = verify_split_transaction(signed, _expectation(p), signed=True)
    assert verified["payer"] == p["payer"]


def _expectation(p: dict) -> dict:
    return {
        "network": p["network"],
        "payee": p["payee"],
        "treasury": p["treasury"],
        "payment_mint": p["paymentMint"],
        "payment_decimals": p["paymentDecimals"],
        "usdc_decimals": p["usdcDecimals"],
        "payee_amount": p["payeeAmount"],
        "fee_net": p["feeNet"],
        "receipt_id": p["receiptId"],
    }


@pytest.mark.parametrize("case", SPLIT["invalid"], ids=lambda c: c["name"])
def test_split_rejects(case):
    p = _params(SPLIT["valid"][0])
    change = dict(case["expectation_change"])
    for k in ("payeeAmount", "feeNet"):
        if k in change:
            change[k] = int(change[k])
    expected = _expectation({**p, **change})
    with pytest.raises(M2mError) as e:
        verify_split_transaction(case["transaction"], expected, signed=True)
    assert e.value.code == case["code"]
    assert str(e.value) == case["reason"]


def test_split_expectation_from_quote():
    quote = QUOTE["quote"]
    assert split_expectation(quote) == {
        "network": quote["network"],
        "payee": quote["payee"],
        "treasury": quote["treasury"],
        "payment_mint": quote["mint"],
        "payment_decimals": 6,
        "usdc_decimals": 6,
        "payee_amount": 9_975_000,
        "fee_net": 25_000,
        "receipt_id": quote["id"],
    }


def test_constants_match_core():
    c = CONSTANTS
    assert str(constants.USD_UNITS) == c["usd_units"]
    assert {k: str(v) for k, v in constants.AGENT_FEE.items()} == {
        "rate_bps": c["agent_fee"]["rateBps"],
        "min": c["agent_fee"]["min"],
        "max": c["agent_fee"]["max"],
    }
    assert str(constants.MIN_PAYMENT) == c["min_payment"]
    r = c["referral"]
    assert constants.REFERRAL == {
        "referred_discount_percent": int(r["referredDiscountPercent"]),
        "referred_discount_days": r["referredDiscountDays"],
        "credit_percent": int(r["creditPercent"]),
        "credit_months": r["creditMonths"],
        "max_combined_discount_percent": int(r["maxCombinedDiscountPercent"]),
        "activation_settlements": r["activationSettlements"],
        "activation_volume": int(r["activationVolume"]),
    }
    assert constants.QUOTE_TTL_SECONDS == c["quote_ttl_seconds"]
    assert str(constants.MAX_COMPUTE_UNIT_PRICE) == c["max_compute_unit_price"]
    assert constants.MEMO_PROGRAM == c["memo"]["program"]
    assert constants.MEMO_PREFIX == c["memo"]["prefix"]
    assert constants.REFUND_MEMO_PREFIX == c["memo"]["refund_prefix"]
    assert constants.X402_VERSION == c["x402"]["version"]
    assert constants.M2M_SPLIT == c["x402"]["scheme"]
    assert constants.NETWORKS == c["networks"]
    assert c["errors"] == ERRORS


ADVERSARIAL = load("adversarial.json")


@pytest.mark.parametrize("case", ADVERSARIAL["cases"], ids=lambda c: c["name"])
def test_adversarial_rejected_like_typescript(case):
    e = ADVERSARIAL["expectation"]
    expected = {
        "network": e["network"],
        "payee": e["payee"],
        "treasury": e["treasury"],
        "payment_mint": e["paymentMint"],
        "payment_decimals": e["paymentDecimals"],
        "usdc_decimals": e["usdcDecimals"],
        "payee_amount": int(e["payeeAmount"]),
        "fee_net": int(e["feeNet"]),
        "receipt_id": e["receiptId"],
    }
    with pytest.raises(M2mError) as err:
        verify_split_transaction(case["transaction"], expected, signed=True)
    assert err.value.code == case["code"]
    assert str(err.value) == case["reason"]


RETRY = load("retry.json")


@pytest.mark.parametrize("v", RETRY["cases"], ids=lambda v: v["name"])
def test_retry_decision(v):
    from m2m_monster.retry import decide_retry

    assert decide_retry(v["evidence"]) == v["expected"]
