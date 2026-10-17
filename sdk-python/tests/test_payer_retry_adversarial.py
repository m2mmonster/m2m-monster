"""Adversarial review of the retry code (D67). Same cases as the TypeScript SDK."""

import threading
import time

import httpx
import pytest
from fakes import SERVICE, jws, signature_of
from test_payer_retry import URL, Env, Lost, code, lost, quote_expired

from m2m_monster.constants import DEVNET
from m2m_monster.receipt import verify_receipt_signature
from m2m_monster.retry import chain_evidence, decide_retry
from m2m_monster.x402 import decode_header, encode_header, payment_outcome

SIG = "5" * 87


class ChainRpc:
    """Answers only getEpochInfo and getSignatureStatuses; records the calls."""

    def __init__(self, epoch, statuses) -> None:
        self.epoch, self.statuses, self.calls = epoch, statuses, []

    def call(self, method, params):
        self.calls.append((method, params))
        value = self.epoch if method == "getEpochInfo" else self.statuses
        if isinstance(value, Exception):
            raise value
        return value


def epoch(height, slot=500):
    return {"blockHeight": height, "absoluteSlot": slot}


def not_found(slot=500):
    return {"context": {"slot": slot}, "value": [None]}


def decide(evidence):
    return decide_retry({"settlement": "other", "receipt": None, **evidence})


def signature_in_header(header: str) -> str:
    return signature_of(decode_header(header)["payload"]["transaction"])


def test_chain_reads_finalized_height_first_then_status_with_history():
    rpc = ChainRpc(epoch(10), not_found())
    chain_evidence(rpc, SIG, 1000)
    assert rpc.calls == [
        ("getEpochInfo", [{"commitment": "finalized"}]),
        ("getSignatureStatuses", [[SIG], {"searchTransactionHistory": True}]),
    ]


def test_expired_only_above_last_valid_block_height():
    def at(h):
        return chain_evidence(ChainRpc(epoch(h), not_found()), SIG, 1000)["blockhash_expired"]

    assert at(999) is False
    assert at(1000) is False  # still valid at its last height
    assert at(1001) is True


def test_not_found_from_a_lagging_node_is_not_trusted():
    lagging = chain_evidence(ChainRpc(epoch(2000, 500), not_found(499)), SIG, 1000)
    assert lagging == {"signature_status": "rpc_error", "blockhash_expired": True}
    assert decide(lagging) == "unknown"
    fresh = chain_evidence(ChainRpc(epoch(2000, 500), not_found(500)), SIG, 1000)
    assert decide(fresh) == "not_paid"


def test_malformed_or_failing_answers_are_rpc_errors():
    cases = [
        ({}, not_found()),
        (epoch(2000), {}),
        (epoch(2000), {"context": {}, "value": [None]}),
        (RuntimeError("down"), not_found()),
        (epoch(2000), RuntimeError("down")),
        (epoch(2000), {"context": {"slot": 500}, "value": ["weird"]}),
    ]
    for e, s in cases:
        assert decide(chain_evidence(ChainRpc(e, s), SIG, 1000)) == "unknown"


def test_err_wins_and_processed_or_unknown_statuses_stay_unknown():
    def status(v):
        return {"context": {"slot": 500}, "value": [v]}

    failed = chain_evidence(
        ChainRpc(epoch(10), status({"err": {"x": 1}, "confirmationStatus": "confirmed"})),
        SIG,
        1000,
    )
    assert failed["signature_status"] == "failed"
    for confirmation in ("processed", None, "something"):
        e = chain_evidence(
            ChainRpc(epoch(2000), status({"err": None, "confirmationStatus": confirmation})),
            SIG,
            1000,
        )
        assert e["signature_status"] == "processed"
        assert decide(e) == "unknown"


def test_a_genuine_receipt_of_another_payment_is_not_proof():
    other = {}

    def script(e, n, r):
        if n == 1:
            return e.resource(r)
        if n == 2:
            return lost()
        return quote_expired(other["transaction"], other["receipt"])

    env = Env(script)
    earlier = payment_outcome(env.client.get(f"{URL}?earlier=1"))
    other.update(transaction=earlier["transaction"], receipt=earlier["receipt"])
    with pytest.raises(Lost):
        env.client.get(URL)
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    env.rpc.block_height = 2000
    assert payment_outcome(env.client.get(URL))["status"] == "not_paid"
    assert len(env.rpc.sent) == 1  # only the earlier purchase


def test_a_service_signed_receipt_for_this_transaction_but_another_quote_is_not_proof():
    state = {}

    def script(e, n, r):
        if n == 1:
            return e.resource(r)
        if n == 2:
            return e.settled_but_lost(r)
        genuine = verify_receipt_signature(state["receipt"], str(SERVICE.pubkey()))
        ours = signature_in_header(e.headers[1])
        return quote_expired(ours, jws({**genuine, "id": "q_another_quote", "transaction": ours}))

    env = Env(script)
    state["receipt"] = payment_outcome(env.client.get(f"{URL}?earlier=1"))["receipt"]
    with pytest.raises(Lost):
        env.client.get(URL)
    outcome = payment_outcome(env.client.get(URL))
    # Decided on-chain (the transaction is confirmed), without trusting the receipt.
    assert outcome["status"] == "already_paid"
    assert "receipt_data" not in outcome
    assert len(env.rpc.sent) == 2


def test_malicious_seller_settles_then_asks_to_pay_again():
    def script(e, n, r):
        e.resource(r)  # takes the money
        return e.resource(httpx.Request("GET", URL))  # and answers with a new PAYMENT-REQUIRED

    env = Env(script)
    res = env.client.get(URL)
    assert res.status_code == 402
    assert payment_outcome(res)["status"] == "already_paid"
    assert len(set(env.headers)) == 1
    assert len(env.rpc.sent) == 1


def test_malicious_seller_claims_success_for_another_transaction():
    body = {"success": True, "transaction": "1" * 64, "network": DEVNET}
    env = Env(
        lambda e, n, r: httpx.Response(200, headers={"PAYMENT-RESPONSE": encode_header(body)})
    )
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    env.rpc.block_height = 2000
    assert payment_outcome(env.client.get(URL))["status"] == "not_paid"
    assert len(set(env.headers)) == 1
    assert env.rpc.sent == []


def test_malicious_seller_rejects_every_payment():
    env = Env(lambda e, n, r: quote_expired())
    for _ in range(3):
        env.rpc.block_height = 10
        assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
        env.rpc.block_height = 2000
        assert payment_outcome(env.client.get(URL))["status"] == "not_paid"
    # One signed payment per round, each new one only after proof the previous cannot land.
    assert len(set(env.headers)) == 3
    assert env.rpc.sent == []


def test_processed_is_unknown_even_with_the_blockhash_expired():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired())
    with pytest.raises(Lost):
        env.client.get(URL)
    env.rpc.statuses[signature_in_header(env.headers[0])] = {
        "err": None,
        "confirmationStatus": "processed",
    }
    env.rpc.block_height = 2000
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    assert len(set(env.headers)) == 1


def test_a_lagging_nodes_not_found_after_expiry_is_not_proof():
    env = Env(lambda e, n, r: lost() if n == 1 else quote_expired())
    with pytest.raises(Lost):
        env.client.get(URL)
    env.rpc.block_height, env.rpc.finalized_slot, env.rpc.status_slot = 2000, 900, 899
    assert code(lambda: env.client.get(URL)) == "PAYMENT_STATUS_UNKNOWN"
    env.rpc.status_slot = 900
    assert payment_outcome(env.client.get(URL))["status"] == "not_paid"


def concurrently(env, n=2):
    results, errors = [None] * n, []

    def run(i):
        try:
            results[i] = env.client.get(URL)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    return results


def slow(handler):
    def script(e, n, r):
        time.sleep(0.2)  # long enough for the other thread to join the same attempt
        return handler(e, n, r)

    return script


def test_two_concurrent_calls_share_one_payment():
    env = Env(slow(lambda e, n, r: e.resource(r)))
    a, b = concurrently(env)
    assert len(env.headers) == 1
    assert len(env.rpc.sent) == 1
    assert env.served == 1
    assert a.status_code == b.status_code == 200
    assert payment_outcome(a)["status"] == "paid"
    assert payment_outcome(b)["transaction"] == payment_outcome(a)["transaction"]


def test_two_concurrent_retries_of_a_pending_payment_resolve_once():
    env = Env(slow(lambda e, n, r: e.settled_but_lost(r) if n == 1 else e.resource(r)))
    with pytest.raises(Lost):
        env.client.get(URL)
    a, b = concurrently(env)
    assert len(env.headers) == 2
    assert payment_outcome(a)["status"] == payment_outcome(b)["status"] == "already_paid"
    assert len(env.rpc.sent) == 1
