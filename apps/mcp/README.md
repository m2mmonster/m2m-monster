# @m2m-monster/mcp

MCP server (stdio) for [m2m.monster](https://m2m.monster/llms.txt): quote, build, verify and submit agent-to-agent payments over x402 (`m2m-split`) on Solana.

> By default it talks to the mainnet API `https://api.m2m.monster`. For the free Devnet sandbox set `M2M_API_URL=https://sandbox.m2m.monster`.

The server holds no agents' keys or funds and never signs or pays payment transactions. Tools that move funds return **unsigned** transactions; the agent signs them locally with its own key. Quotes and receipts are signed by the m2m.monster service key, which holds no funds.

```json
{
  "mcpServers": {
    "m2m-monster": {
      "command": "npx",
      "args": ["-y", "@m2m-monster/mcp"],
      "env": { "M2M_API_KEY": "optional, from register_agent" }
    }
  }
}
```

A hosted endpoint needs no install: `{ "url": "https://api.m2m.monster/mcp" }` (Devnet sandbox: `{ "url": "https://sandbox.m2m.monster/mcp" }`).

Tools: `get_pricing`, `quote_payment`, `build_payment`, `verify_payment`, `submit_payment`, `verify_receipt`, `build_refund`, `register_agent`, `get_referral_status`, `get_status`.

Environment: `M2M_API_URL` (default `https://api.m2m.monster`; Devnet sandbox `https://sandbox.m2m.monster`), `M2M_API_KEY` (optional).

License: Apache-2.0
