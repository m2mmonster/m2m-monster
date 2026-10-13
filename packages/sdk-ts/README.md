# @m2m-monster/sdk

TypeScript SDK for [m2m.monster](https://sandbox.m2m.monster/llms.txt): non-custodial agent-to-agent payments over x402 v2 with the `m2m-split` scheme on Solana.

> **0.x beta, Devnet only.** Use the sandbox API `https://sandbox.m2m.monster` and Devnet keys.

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

Docs: https://sandbox.m2m.monster/llms.txt · OpenAPI: https://sandbox.m2m.monster/v1/openapi.json · Errors: https://sandbox.m2m.monster/v1/errors

License: Apache-2.0
