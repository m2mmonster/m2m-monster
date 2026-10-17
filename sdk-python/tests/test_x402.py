"""x402 v2 with m2m-split: PaymentClient (payer) against Paywall (payee)."""

import httpx
from fakes import PAYEE, PAYER, SERVICE, funded_rpc, jws, signature_of, signed_quote

from m2m_monster.constants import DEVNET
from m2m_monster.errors import M2mError
from m2m_monster.quote import price_split, split_expectation
from m2m_monster.split import verify_split_transaction
from m2m_monster.x402 import (
    PAYMENT_REQUIRED,
    PaymentClient,
    Paywall,
    decode_header,
    settlement_of,
)

USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
PRICE = {"mint": USDC, "amount": "100000"}
URL = "https://agent.example/forecast"


class FakeApi:
    """Stands in for the m2m API: quotes and an idempotent relay."""

    def __init__(self, rpc) -> None:
        self.rpc = rpc
        self.settled: dict[str, dict] = {}
        self.reported: dict[str, dict] = {}
        self.quotes = 0

    def service_address(self) -> str:
        return str(SERVICE.pubkey())

    def request_quote(self, network, mint, amount, payee, idempotency_key) -> dict:
        p = price_split(int(amount), 6)
        self.quotes += 1
        return signed_quote(
            id=f"q_test_{self.quotes:04d}",
            network=network,
            mint=mint,
            amount=str(amount),
            payee=payee,
            payee_amount=str(p["payee_amount"]),
            fee_gross=str(p["fee_gross"]),
            discount=str(p["discount"]),
            fee_net=str(p["fee_net"]),
        )

    def relay_payment(self, quote, transaction, idempotency_key) -> dict:
        if idempotency_key in self.settled:
            return {**self.settled[idempotency_key], "replayed": True}
        verified = verify_split_transaction(transaction, split_expectation(quote), signed=True)
        signature = self.rpc.call("sendTransaction", [transaction])
        fields = ("network", "payee", "treasury", "mint", "decimals", "usdc_decimals")
        receipt = {
            "id": quote["id"],
            "transaction": signature,
            "payer": verified["payer"],
            "amount": quote["amount"],
            "payee_amount": quote["payee_amount"],
            "fee_net": quote["fee_net"],
            "referral": quote["referral"],
            **{k: quote[k] for k in fields},
        }
        result = {"signature": signature, "receipt": jws(receipt), "receipt_data": receipt}
        self.settled[idempotency_key] = result
        return {**result, "replayed": False}

    def report_payment(self, quote, signature) -> dict:
        if signature in self.reported:
            return {**self.reported[signature], "replayed": True}
        receipt = {"id": quote["id"], "transaction": signature, "amount": quote["amount"]}
        receipt["referral"] = quote["referral"]
        receipt["payer"] = str(PAYER.pubkey())
        result = {"signature": signature, "receipt": jws(receipt), "receipt_data": receipt}
        self.reported[signature] = result
        return {**result, "replayed": False}


def setup(submit: str = "relay"):
    rpc = funded_rpc()
    paywall = Paywall(FakeApi(rpc), rpc, DEVNET, str(PAYEE.pubkey()), submit=submit)
    served = []

    def handler(request: httpx.Request) -> httpx.Response:
        outcome = paywall.handle(
            request.headers, str(request.url), PRICE, {"description": "Forecast"}
        )
        if not outcome.paid:
            return httpx.Response(outcome.status, headers=outcome.headers, content=outcome.body)
        served.append(outcome.settlement)
        return httpx.Response(200, json={"forecast": "sunny"}, headers=outcome.headers)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = PaymentClient(rpc, PAYER, str(SERVICE.pubkey()), network=DEVNET, http=http)
    return rpc, http, client, served


def test_402_offers_m2m_split():
    _, http, _, _ = setup()
    res = http.get(URL)
    assert res.status_code == 402
    required = decode_header(res.headers[PAYMENT_REQUIRED])
    assert required["x402Version"] == 2
    accepted = required["accepts"][0]
    assert accepted["scheme"] == "m2m-split"
    assert accepted["extra"]["fee_net"] == "1000"
    assert accepted["extra"]["paymentFlow"] == "upfront"
    assert required["extensions"]["payment-identifier"]["info"] == {"required": True}
    assert f"ref={PAYEE.pubkey()}" in required["extensions"]["m2m-referral"]["info"]["link"]


def test_pays_and_gets_the_resource():
    rpc, _, client, served = setup()
    res = client.get(URL)
    assert res.status_code == 200
    assert res.json() == {"forecast": "sunny"}
    settlement = settlement_of(res)
    assert settlement["success"] is True
    assert settlement["payer"] == str(PAYER.pubkey())
    assert settlement["transaction"] == signature_of(rpc.sent[0])
    assert settlement["extensions"]["m2m-receipt"]["info"]["receipt"].count(".") == 2
    assert len(rpc.sent) == 1 and len(served) == 1


def _replay(submit: str):
    from m2m_monster.x402 import encode_header

    rpc, http, client, served = setup(submit)
    res = http.get(URL)
    payload = client.payment_payload(decode_header(res.headers[PAYMENT_REQUIRED]))
    header = {"PAYMENT-SIGNATURE": encode_header(payload)}
    first = http.get(URL, headers=header)
    again = http.get(URL, headers=header)
    return rpc, served, first, again


def test_a_replayed_payment_signature_never_unlocks_the_resource_again():
    rpc, served, first, again = _replay("relay")
    assert first.status_code == 200
    assert again.status_code == 402
    failure = settlement_of(again)
    assert failure["success"] is False
    assert failure["errorReason"] == "QUOTE_EXPIRED"
    assert failure["transaction"] == settlement_of(first)["transaction"]
    receipt = settlement_of(first)["extensions"]["m2m-receipt"]["info"]["receipt"]
    assert failure["extensions"]["m2m-receipt"]["info"]["receipt"] == receipt
    assert len(served) == 1 and len(rpc.sent) == 1

    # The recognition documented in the README ("Retries: never pay twice").
    res = again
    s = settlement_of(res) or {}
    found = (s.get("extensions") or {}).get("m2m-receipt", {}).get("info", {}).get("receipt")
    assert res.status_code == 402 and s.get("errorReason") == "QUOTE_EXPIRED"
    assert s.get("transaction") and found == receipt


def test_a_replayed_payment_is_refused_in_self_mode_too():
    rpc, served, first, again = _replay("self")
    assert first.status_code == 200
    assert again.status_code == 402
    assert settlement_of(again)["errorReason"] == "QUOTE_EXPIRED"
    assert len(served) == 1 and len(rpc.sent) == 1


def test_rejects_a_quote_for_another_price():
    rpc, http, client, _ = setup()
    cheaper = signed_quote(amount="1000", payee_amount="0", fee_gross="1000", fee_net="1000")
    from m2m_monster.x402 import encode_header, payment_required

    payload = client.payment_payload(payment_required(cheaper, {"url": URL}))
    res = http.get(URL, headers={"PAYMENT-SIGNATURE": encode_header(payload)})
    assert res.status_code == 402
    assert settlement_of(res)["errorReason"] == "PAYMENT_TRANSACTION_INVALID"
    assert rpc.sent == []


def test_submit_self():
    rpc, _, client, _ = setup(submit="self")
    res = client.get(URL)
    assert res.status_code == 200
    assert len(rpc.sent) == 1


def test_m2m_error_is_an_exception_with_code():
    error = M2mError("RATE_LIMITED")
    assert error.code == "RATE_LIMITED"
    assert str(error) == "Too many requests. Retry later."
