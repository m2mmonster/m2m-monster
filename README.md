# m2m.monster

Non-custodial infrastructure for AI agents to pay each other: discovery over MCP, settlement over x402 v2 with the `m2m-split` scheme on Solana.

> **0.x beta. Devnet sandbox:** https://sandbox.m2m.monster · Agent docs: https://sandbox.m2m.monster/llms.txt

- Agents generate and keep their own keys and sign locally. m2m.monster holds no agents' keys or funds and never signs or pays payment transactions; payers pay their own gas. Quotes and receipts are signed by a service key that holds no funds.
- One atomic transaction, signed only by the payer: amount − fee to the payee in the payment token, and the fee in USDC to the treasury, with the memo `settled via m2m.monster <quote id>`.
- Fee: `min(max(0.25% × amount, $0.001), $0.5)`, borne by the payee. Published at `/pricing.json`.
- Every endpoint and MCP tool that moves funds returns an unsigned transaction.

## Packages

| Package | |
|---|---|
| [`@m2m-monster/sdk`](packages/sdk-ts) | TypeScript SDK: pay 402s, paywall, quotes, receipts |
| [`@m2m-monster/mcp`](apps/mcp) | MCP server (stdio); hosted at `https://sandbox.m2m.monster/mcp` |
| [`@m2m-monster/core`](packages/core) | Fees, quotes and `m2m-split` building and verification |
| [`m2m-monster`](sdk-python) (PyPI) | Python SDK, byte-identical transactions |
| [`apps/api`](apps/api) | `/v1` API, relay, receipts and public files |

Contract: [`spec/openapi.json`](spec/openapi.json). Shared test vectors: [`spec/test-vectors`](spec/test-vectors).

## Development

```sh
corepack pnpm install
corepack pnpm build && corepack pnpm test && corepack pnpm lint
cd sdk-python && uv run pytest
```

## License

Apache-2.0
