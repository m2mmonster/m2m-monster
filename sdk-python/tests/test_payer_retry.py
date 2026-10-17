"""PaymentClient never pays twice for one request (section K; D54, D66). Same cases as TS."""

import httpx
import pytest
from fakes import PAYEE, PAYER, SERVICE, funded_rpc, signature_of
from test_x402 import PRICE, URL, FakeApi

from m2m_monster.constants import DEVNET
from m2m_monster.errors import M2mError
from m2m_monster.x402 import (
    PaymentClient,
    Paywall,
    encode_header,
    payment_outcome,
    settlement_of,
)


class Lost(httpx.TransportError):
    pass


def quote_expired(transaction: str = "", receipt: str | None = None) -> httpx.Response:
    body = {"success": False, "errorReason": "QUOTE_EXPIRED", "transaction": transaction}
    body["network"] = DEVNET
    if receipt:
        body["extensions"] = {"m2m-receipt": {"info": {"receipt": receipt}}}
    return httpx.Response(402, headers={"PAYMENT-RESPONSE": encode_header(body)}, json={})


class Env:
    """Real Paywall and fake relay; `script(attempt, request)` answers each paid attempt."""

    def __init__(self, script) -> None:
        self.rpc = funded_rpc()
        self.paywall = Paywall(FakeApi(self.rpc), self.rpc, DEVNET, str(PAYEE.pubkey()))
        self.served = 0
        self.headers: list[str] = []
        self.attempt = 0
        self.script = script
        http = httpx.Client(transport=httpx.MockTransport(self.transport))
        self.client = PaymentClient(
            self.rpc, PAYER, str(SERVICE.pubkey()), network=DEVNET, http=http
        )

    def resource(self, request: httpx.Request) -> httpx.Response:
        outcome = self.paywall.handle(request.headers, str(request.url), PRICE, {})
        if not outcome.paid:
            return httpx.Response(outcome.status, headers=outcome.headers, content=outcome.body)
        self.served += 1
        return httpx.Response(200, json={"forecast": "sunny"}, headers=outcome.headers)

    def settled_but_lost(self, request: httpx.Request):
        self.resource(request)
        raise Lost("response lost")

    def transport(self, request: httpx.Request) -> httpx.Response:
        header = request.headers.get("PAYMENT-SIGNATURE")
        if not header:
            return self.resource(request)
        self.headers.append(header)
        self.attempt += 1
        return self.script(self, self.attempt, request)


def lost(*_):
    raise Lost("response lost")


def code(call) -> str:
    with pytest.raises(M2mError) as e:
        call()
    return e.value.code


def test_pays_loses_the_response_and_retries_once():
    env = Env(lambda e, n, r: e.settled_but_lost(r) if n == 1 else e.resource(r))
    with pytest.raises(Lost):
        env.client.get(URL)
    assert len(env.rpc.sent) == 1

    again = env.client.get(URL)
    assert again.status_code == 402
    assert env.headers[1] == env.headers[0]
    assert len(env.rpc.sent) == 1 and env.served == 1
    outcome = payment_outcome(again)
    assert outcome["status"] == "already_paid"
    assert outcome["transaction"] == signature_of(env.rpc.sent[0])
    assert outcome["receipt_data"]["transaction"] == outcome["transaction"]
    receipt = settlement_of(again)["extensions"]["m2m-receipt"]["info"]["receipt"]
    assert outcome["receipt"] == receipt

    following = env.client.get(URL)
    assert following.status_code == 200
    assert payment_outcome(following)["status"] == "paid"
    # A new purchase with a new payment id (the fake quotes repeat the same bytes on-chain).
    assert env.served == 2 and env.headers[2] != env.headers[0]


def test_a_normal_payment_reports_paid():
    env = Env(lambda e, n, r: e.resource(r))
    res = env.client.get(URL)
    assert res.status_code == 200
    assert payment_outcome(res)["status"] == "paid"
    assert isinstance(payment_outcome(res)["receipt"], str)


def test_quote_expired_without_receipt_confirmed_on_chain():
    env = Env(lambda e, n, r: e.settled_but_lost(r) if n == 1 else quote_expired())
    with pytest.raises(Lost):
        env.client.get(URL)
    outcome = payment_outcome(env.client.get(URL))
    assert outcome["status"] == "already_paid" and "receipt" not in outcome
    assert len(env.rpc.sent) == 1


def test_never_landed_and_blockhash_expired_then_pays():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired() if n == 2 else e.resource(r))
    with pytest.raises(Lost):
        env.client.get(URL)
    env.rpc.block_height = 2000
    again = env.client.get(URL)
    assert again.status_code == 402
    assert payment_outcome(again)["status"] == "not_paid"
    assert env.rpc.sent == []

    env.rpc.block_height = 10
    paid = env.client.get(URL)
    assert paid.status_code == 200
    assert len(env.rpc.sent) == 1
    assert env.headers[2] != env.headers[0]


def test_never_landed_blockhash_valid_is_unknown_and_keeps_the_payment():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired() if n == 2 else e.resource(r))
    with pytest.raises(Lost):
        env.client.get(URL)
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    assert env.rpc.sent == []
    res = env.client.get(URL)
    assert res.status_code == 200
    assert len(env.headers) == 3 and len(set(env.headers)) == 1
    assert len(env.rpc.sent) == 1


def test_rpc_down_is_unknown_without_a_new_quote_or_payment():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired())
    with pytest.raises(Lost):
        env.client.get(URL)
    env.rpc.failing = {"getSignatureStatuses", "getBlockHeight", "getTransaction"}
    env.rpc.block_height = 2000
    for _ in range(2):
        assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    assert len(set(env.headers)) == 1
    assert env.rpc.sent == []


def test_a_receipt_that_does_not_verify_is_not_proof():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired("5" * 87, "aaa.bbb.ccc"))
    with pytest.raises(Lost):
        env.client.get(URL)
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    env.rpc.block_height = 2000
    assert payment_outcome(env.client.get(URL))["status"] == "not_paid"


def test_an_explicit_idempotency_key_binds_the_payment():
    env = Env(lambda e, n, r: e.settled_but_lost(r) if n == 1 else e.resource(r))
    headers = {"Idempotency-Key": "order-42"}
    with pytest.raises(Lost):
        env.client.get(URL, headers=headers)
    again = env.client.get(f"{URL}?retry=1", headers=headers)
    assert payment_outcome(again)["status"] == "already_paid"
    assert len(env.rpc.sent) == 1
