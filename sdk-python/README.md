# m2m-monster (Python)

Python SDK for [m2m.monster](https://m2m.monster/llms.txt): non-custodial agent-to-agent payments over x402 v2 with the `m2m-split` scheme on Solana. Builds the same bytes as the TypeScript SDK.

> Mainnet API: `https://api.m2m.monster`. Free Devnet sandbox for testing: `https://sandbox.m2m.monster` with Devnet keys and a Devnet RPC. The examples below use the sandbox, so copying them never spends real funds.

Agents keep their own keys; the SDK builds, simulates and signs locally. The fee (`min(max(0.25% × amount, $0.001), $0.5)`, borne by the payee) is paid in USDC to the treasury inside the same transaction; the payer pays its own gas.

```sh
pip install m2m-monster
```

## Pay a seller that answers 402

```python
from solders.keypair import Keypair
from m2m_monster import ApiClient, PaymentClient, Rpc

api = ApiClient("https://sandbox.m2m.monster")
client = PaymentClient(
    Rpc("https://api.devnet.solana.com"),
    Keypair.from_base58_string(SECRET_KEY),  # stays local
    api.service_address(),
)
res = client.get("https://seller.example/resource")  # 402 -> pay -> 200
```

## Get paid

```python
from m2m_monster import ApiClient, DEVNET, Paywall, Rpc

paywall = Paywall(ApiClient("https://sandbox.m2m.monster"), Rpc("https://api.devnet.solana.com"), DEVNET, "YOUR_WALLET")
outcome = paywall.handle(request_headers, request_url, {"mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "amount": "100000"})
if not outcome.paid:
    return outcome.status, outcome.headers, outcome.body   # the 402
# run your handler, then add outcome.headers (PAYMENT-RESPONSE with the receipt)
```

## Retries: never pay twice

`PaymentClient` keeps each payment it signs in memory, bound to the request (its
`Idempotency-Key` header, else method, URL and body), until the outcome is known. If a call fails
after paying (for example the response is lost), repeat the same call: it resends the same signed
payment instead of requesting a new quote, and decides from the seller's answer and the chain.

```python
from m2m_monster import payment_outcome

res = client.get("https://seller.example/resource")  # if it raises, repeat this same call
outcome = payment_outcome(res)  # None when no payment was needed
# outcome["status"]: "paid" | "already_paid" | "not_paid"; outcome["transaction"],
# outcome["receipt"], outcome["receipt_data"] (only when the SDK verified the receipt)
```

- `paid`: this response settled the payment.
- `already_paid`: an earlier attempt paid; the seller does not serve the resource again. The
  receipt is set when the seller returned it and the SDK verified it on-chain (service signature,
  confirmed transaction, this payment's signature); otherwise the transaction is confirmed
  on-chain.
- `not_paid`: proven not settled (failed on-chain, or not found after its blockhash expired). The
  next call pays again with a new quote.
- Error `PAYMENT_STATUS_UNKNOWN` (`M2mError`): the outcome could not be determined (RPC unavailable, or the
  transaction not found while its blockhash is still valid, about a minute or two after signing).
  The SDK keeps the payment and does not pay again for that request; repeat the same call later.

Concurrent calls for the same request share one attempt and never sign twice.

Pending payments live in memory only. After a process restart the SDK does not know a payment
signed before the restart: repeating the request gets a new quote and signs a new payment. Before
paying again after a restart, check the chain: list your payer address's recent transactions
(`getSignaturesForAddress`) and look for an m2m-split payment to that payee (memo
`settled via m2m.monster <quote id>`) since before the restart.

### Without the SDK

A signed payment is valid once and unlocks the resource once. If you send the same
`PAYMENT-SIGNATURE` again, nothing is paid or served again. The seller answers `402` with:

- body `{"error":{"code":"QUOTE_EXPIRED","message":"This payment was already used."}}`
- header `PAYMENT-RESPONSE` (base64 JSON): `success: false`, `errorReason: "QUOTE_EXPIRED"`,
  `transaction` = the Solana signature of your original payment, `payer`, and
  `extensions["m2m-receipt"].info.receipt` = the original signed receipt.

`QUOTE_EXPIRED` with a `transaction` and a receipt is proof that you already paid: verify the
receipt (`POST /v1/receipts/verify` with `{"receipt": "<jws>"}`, or `verify_receipt` over MCP) and
do not pay again. `QUOTE_EXPIRED` without them proves nothing: before paying again, check
on-chain whether the transaction you signed landed (`getSignatureStatuses` with
`searchTransactionHistory`) and wait until its blockhash has expired.

Docs: https://m2m.monster/llms.txt · Errors: https://api.m2m.monster/v1/errors · Devnet sandbox docs: https://sandbox.m2m.monster/llms.txt

License: Apache-2.0
