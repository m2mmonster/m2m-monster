# @m2m-monster/sdk

TypeScript SDK for [m2m.monster](https://m2m.monster/llms.txt): non-custodial agent-to-agent payments over x402 v2 with the `m2m-split` scheme on Solana.

> Mainnet API: `https://api.m2m.monster`. Free Devnet sandbox for testing: `https://sandbox.m2m.monster` with Devnet keys and a Devnet RPC. The examples below use the sandbox, so copying them never spends real funds.

- Agents keep their own keys; the SDK builds, simulates and signs locally.
- One atomic transaction signed only by the payer: amount − fee to the payee, the fee in USDC to the treasury. The payer pays its own gas.
- Fee: `min(max(0.25% × amount, $0.001), $0.5)`, borne by the payee. See `/pricing.json`.

```sh
npm install @m2m-monster/sdk @solana/kit
```

## Pay a seller that answers 402

```ts
import { createApiClient, createPaymentFetch } from "@m2m-monster/sdk";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";

const signer = await createKeyPairSignerFromBytes(secretKeyBytes); // stays local
const api = createApiClient("https://sandbox.m2m.monster");
const pay = createPaymentFetch({
  rpc: createSolanaRpc("https://api.devnet.solana.com"),
  signer,
  serviceAddress: await api.serviceAddress(),
});
const res = await pay("https://seller.example/resource"); // 402 -> pay -> 200
```

## Get paid

```ts
import { createApiClient, createPaywall } from "@m2m-monster/sdk";
import { createSolanaRpc } from "@solana/kit";

const paywall = createPaywall({
  api: createApiClient("https://sandbox.m2m.monster"),
  rpc: createSolanaRpc("https://api.devnet.solana.com"),
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  payee: "YOUR_WALLET",
});
// In any fetch-style handler:
return paywall.handle(
  request,
  { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", amount: "100000" },
  { description: "Forecast" },
  () => Response.json({ forecast: "sunny" }),
);
```

The payee's token account and the treasury USDC account must exist before paying; payments never create accounts.

## Retries: never pay twice

`createPaymentFetch` keeps each payment it signs in memory, bound to the request (its
`Idempotency-Key` header, else method, URL and body), until the outcome is known. If a call fails
after paying (for example the response is lost), repeat the same call: it resends the same signed
payment instead of requesting a new quote, and decides from the seller's answer and the chain.

```ts
import { paymentOutcome } from "@m2m-monster/sdk";

const res = await pay("https://seller.example/resource"); // if it throws, repeat this same call
const outcome = paymentOutcome(res); // undefined when no payment was needed
// outcome.status: "paid" | "already_paid" | "not_paid"; outcome.transaction, outcome.receipt,
// outcome.receiptData (only when the SDK verified the receipt)
```

- `paid`: this response settled the payment.
- `already_paid`: an earlier attempt paid; the seller does not serve the resource again. The
  receipt is set when the seller returned it and the SDK verified it on-chain (service signature,
  confirmed transaction, this payment's signature); otherwise the transaction is confirmed
  on-chain.
- `not_paid`: proven not settled (failed on-chain, or not found after its blockhash expired). The
  next call pays again with a new quote.
- Error `PAYMENT_STATUS_UNKNOWN`: the outcome could not be determined (RPC unavailable, or the
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

Docs: https://m2m.monster/llms.txt · OpenAPI: https://api.m2m.monster/v1/openapi.json · Errors: https://api.m2m.monster/v1/errors · Devnet sandbox docs: https://sandbox.m2m.monster/llms.txt

License: Apache-2.0
