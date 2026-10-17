// Public discoverability files (section B), generated from core constants so what is published
// matches what is enforced. Only what works today is listed (D12, D13). No USDT promotion or
// links to buy any token (section J, condition 5).

import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  DEVNET,
  ERRORS,
  M2M_SPLIT,
  NETWORKS,
  type Network,
  pricing,
  QUOTE_TTL_SECONDS,
  X402_VERSION,
} from "@m2m-monster/core";
import { isAddress } from "@solana/kit";
import type { AppDeps } from "./app.js";
import { TERMS_TEXT, TERMS_TITLE, TERMS_VERSION } from "./terms-text.js";

const VERSION = "1.1.0";

const DESCRIPTION =
  "Non-custodial settlement for agent-to-agent payments over x402 with the m2m-split scheme on Solana. Agents sign locally; m2m.monster holds no agents' keys or funds and never signs or pays payment transactions; payers pay their own gas.";

const TOOLS: [id: string, name: string, description: string][] = [
  ["get_pricing", "Get pricing", "Fee formula, referral program and whitelisted token mints."],
  ["quote_payment", "Quote a payment", "Signed 30-second quote with the fee breakdown."],
  ["build_payment", "Build a payment", "Unsigned m2m-split transaction for the payer to sign."],
  ["verify_payment", "Verify a payment", "Payee check of a payer-signed transaction."],
  [
    "submit_payment",
    "Submit a payment",
    "Broadcast a payer-signed transaction; returns a receipt.",
  ],
  ["verify_receipt", "Verify a receipt", "Check a receipt signature and its on-chain transaction."],
  ["build_refund", "Build a refund", "Unsigned refund from the payee back to the payer."],
  ["register_agent", "Register an agent", "Optional challenge-signed registration."],
  ["get_referral_status", "Referral status", "Referrer, referred agents and credits."],
  ["get_status", "Service status", "Service status and API version."],
];

// `base` serves the public files and referral links; `api` serves /v1 and /mcp. In production
// they are m2m.monster and api.m2m.monster (same container); elsewhere they are equal.
function urls(base: string, api: string) {
  return {
    api: `${api}/v1`,
    openapi: `${api}/v1/openapi.json`,
    errors: `${api}/v1/errors`,
    mcp: `${api}/mcp`,
    mcp_manifest: `${base}/.well-known/mcp.json`,
    agent_card: `${base}/.well-known/agent-card.json`,
    x402: `${base}/.well-known/x402.json`,
    pricing: `${base}/pricing.json`,
    capabilities: `${base}/capabilities.json`,
    terms: `${base}/terms.json`,
    terms_page: `${base}/terms`,
    status: `${base}/status.json`,
    docs: `${base}/llms.txt`,
  };
}

export function mcpManifest(base: string, ref?: string, api = base) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "monster.m2m/m2m-monster",
    title: "m2m.monster",
    description: DESCRIPTION,
    version: VERSION,
    websiteUrl: base,
    remotes: [{ type: "streamable-http", url: `${api}/mcp` }],
    tools: TOOLS.map(([name, , description]) => ({ name, description })),
    ...(ref && {
      referral: {
        referred_by: ref,
        how: "Pass referred_by in register_agent (or POST /v1/agents/register). Registration is optional.",
      },
    }),
  };
}

export function agentCard(base: string, api = base) {
  return {
    name: "m2m.monster",
    description: `${DESCRIPTION} Interfaces: REST API (${api}/v1/openapi.json) and MCP (${api}/mcp). It does not expose an A2A protocol binding.`,
    supportedInterfaces: [],
    provider: { organization: "m2m.monster", url: base },
    version: VERSION,
    documentationUrl: `${base}/llms.txt`,
    capabilities: {},
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: TOOLS.map(([id, name, description]) => ({
      id,
      name,
      description,
      tags: ["payments", "x402", "solana"],
    })),
  };
}

export function x402Info(network: Network, api: string) {
  const config = NETWORKS[network];
  return {
    x402Version: X402_VERSION,
    schemes: [
      {
        scheme: M2M_SPLIT,
        network,
        assets: config.mints,
        fee_asset: { symbol: "USDC", mint: config.usdc },
        treasury: config.treasury,
        payment_flow: "upfront",
        max_timeout_seconds: QUOTE_TTL_SECONDS,
        description:
          "One atomic transaction signed only by the payer, who is also fee payer: transfer of amount − fee_net to the payee in the payment token, fee_net in USDC to the treasury, memo `settled via m2m.monster <quote id>`.",
      },
    ],
    headers: ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"],
    extensions: ["payment-identifier", "m2m-referral", "m2m-receipt"],
    quotes: `${api}/v1/quotes`,
    relay: `${api}/v1/payments`,
    specification: "https://github.com/x402-foundation/x402",
  };
}

export function capabilities(base: string, network: Network, api = base) {
  const tokens = NETWORKS[network].mints.map((m) => m.symbol);
  return {
    version: 1,
    non_custodial: true,
    capabilities: {
      settlement: {
        scheme: M2M_SPLIT,
        network,
        tokens,
        fee_token: "USDC",
        description:
          "Atomic payer-signed settlement with the fee to the treasury in the same transaction. The payer pays its own gas.",
      },
      verifiable_receipts: {
        description:
          "Signed receipt (compact JWS, EdDSA) per settlement, linked to the on-chain signature.",
        verify: `${api}/v1/receipts/verify`,
      },
      refund_tooling: {
        description:
          "Builds unsigned refunds from the payee back to the payer, linked to the original receipt.",
        build: `${api}/v1/refunds/build`,
      },
      relay: {
        description:
          "Broadcasts transactions the payer already signed. Never signs or pays payment transactions.",
        submit: `${api}/v1/payments`,
      },
      discovery: {
        mcp: `${api}/mcp`,
        openapi: `${api}/v1/openapi.json`,
        x402: `${base}/.well-known/x402.json`,
      },
      referral_credits: {
        description:
          "Fee discounts for agents that bring new agents to the network. Credits are not cash.",
        pricing: `${base}/pricing.json`,
      },
      registration: {
        optional: true,
        unlocks: ["referral_credits", "receipt_history"],
      },
    },
  };
}

/**
 * Mainnet: the approved terms, generated from docs/terms-en.md (D56). Devnet: the section J
 * statements, still marked as a draft (the sandbox does not change).
 */
export function terms(base: string, network: Network) {
  if (network !== DEVNET) {
    return {
      title: TERMS_TITLE,
      version: TERMS_VERSION,
      last_updated: TERMS_VERSION,
      language: "en",
      text: TERMS_TEXT,
      pricing: `${base}/pricing.json`,
    };
  }
  return draftTerms(base);
}

/** Devnet sandbox terms: the section J statements, still a draft. */
function draftTerms(base: string) {
  return {
    version: 1,
    status: "draft, pending legal review before mainnet",
    statement:
      "Non-custodial software provider, not a payment intermediary, not a CASP, does not hold means of access.",
    fee: "The fee is a software usage license fee, not a payment processing commission. It is paid in USDC to the m2m.monster treasury inside the same transaction the payer signs.",
    commitments: [
      "Agents generate and store their keys locally and sign client-side. m2m.monster never sees agents' seed phrases or private keys and has no recovery capability. Its service key signs quotes and receipts only and never holds funds.",
      "m2m.monster never holds agents' funds: no pooled wallets, no escrow, no ability to freeze. Transfers go directly from the payer's wallet to the payee's wallet.",
      "m2m.monster never sponsors gas. The payer pays its own network fees.",
      "Fees are collected only in USDC. USDT is supported only as a token for agent-to-agent settlement; m2m.monster does not collect fees in it or convert it into other tokens.",
      "m2m.monster does not convert between fiat currency and stablecoins.",
      "m2m.monster cannot recover wallets or reverse payments. Refunds are new transfers signed by the payee.",
      "Referral credits are discounts on m2m.monster fees. They are not cash and cannot be withdrawn, exchanged or transferred.",
    ],
    pricing: `${base}/pricing.json`,
  };
}

/** Human-readable /terms (section J condition 6): the same content as /terms.json. */
export function termsPage(base: string, network: Network): string {
  if (network !== DEVNET) return TERMS_TEXT;
  const t = draftTerms(base);
  return `m2m.monster terms (${t.status})

${t.statement}

${t.fee}

${t.commitments.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Pricing: ${t.pricing}
`;
}

export function status(network: Network, serviceAddress: string) {
  return {
    status: "ok" as const,
    api_version: "v1",
    versions: ["v1"],
    network,
    service_key: serviceAddress,
    deprecations: [] as string[],
  };
}

export function agentDocs(base: string, network: Network, api = base): string {
  const p = pricing(network);
  const config = NETWORKS[network];
  const usdc = config.usdc;
  const tokens = config.mints.map((m) => `- ${m.symbol}: \`${m.mint}\``).join("\n");
  return `# m2m.monster

> ${DESCRIPTION}

- Network: \`${network}\` (${config.name})
- API: ${api}/v1 · OpenAPI: ${api}/v1/openapi.json · Errors: ${api}/v1/errors
- MCP (streamable HTTP): ${api}/mcp
- x402 scheme: \`${M2M_SPLIT}\` (x402 v${X402_VERSION})

## Fee

\`${p.agent_to_agent.formula}\`

- Borne by the payee: it receives the amount minus the fee.
- Paid in USDC (\`${usdc}\`) to the treasury \`${config.treasury}\`, inside the same transaction.
- Minimum payment $${p.agent_to_agent.min_payment_usd}. Fees round up to 0.000001 USDC.
- Quotes are valid for ${QUOTE_TTL_SECONDS} seconds and show fee_gross, discount and fee_net.
- The payer pays its own gas and needs USDC for the fee even when paying in another token.

## Tokens (exact mint addresses)

${tokens}

## Pay a seller that answers 402 (TypeScript)

\`\`\`ts
import { createApiClient, createPaymentFetch } from "@m2m-monster/sdk";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";

const signer = await createKeyPairSignerFromBytes(yourSecretKeyBytes); // stays local
const api = createApiClient("${api}");
const pay = createPaymentFetch({
  rpc: createSolanaRpc(YOUR_RPC_URL),
  signer,
  serviceAddress: await api.serviceAddress(),
});
const res = await pay("https://seller.example/resource"); // 402 -> pay -> 200
\`\`\`

## Get paid (TypeScript)

\`\`\`ts
import { createApiClient, createPaywall } from "@m2m-monster/sdk";
import { createSolanaRpc } from "@solana/kit";

const paywall = createPaywall({
  api: createApiClient("${api}", { apiKey: YOUR_API_KEY }), // apiKey optional
  rpc: createSolanaRpc(YOUR_RPC_URL),
  network: "${network}",
  payee: YOUR_WALLET,
});
// In any fetch-style handler:
return paywall.handle(request, { mint: "${usdc}", amount: "100000" }, { description: "..." }, () =>
  Response.json({ result: "..." }),
);
\`\`\`

The payee's token account and the treasury USDC account must exist before paying; payments never create accounts.

## Retries: never pay twice

\`createPaymentFetch\` keeps each payment it signs in memory, bound to the request (its
\`Idempotency-Key\` header, else method, URL and body), until the outcome is known. If a call fails
after paying (for example the response is lost), repeat the same call: it resends the same signed
payment instead of requesting a new quote, and decides from the seller's answer and the chain.

\`\`\`ts
import { paymentOutcome } from "@m2m-monster/sdk";

const res = await pay("https://seller.example/resource"); // if it throws, repeat this same call
const outcome = paymentOutcome(res); // undefined when no payment was needed
// outcome.status: "paid" | "already_paid" | "not_paid"; outcome.transaction, outcome.receipt,
// outcome.receiptData (only when the SDK verified the receipt)
\`\`\`

- \`paid\`: this response settled the payment.
- \`already_paid\`: an earlier attempt paid; the seller does not serve the resource again. The
  receipt is set when the seller returned it and the SDK verified it on-chain (service signature,
  confirmed transaction, this payment's signature); otherwise the transaction is confirmed
  on-chain.
- \`not_paid\`: proven not settled (failed on-chain, or not found after its blockhash expired). The
  next call pays again with a new quote.
- Error \`PAYMENT_STATUS_UNKNOWN\`: the outcome could not be determined (RPC unavailable, or the
  transaction not found while its blockhash is still valid, about a minute or two after signing).
  The SDK keeps the payment and does not pay again for that request; repeat the same call later.

Concurrent calls for the same request share one attempt and never sign twice.

Pending payments live in memory only. After a process restart the SDK does not know a payment
signed before the restart: repeating the request gets a new quote and signs a new payment. Before
paying again after a restart, check the chain: list your payer address's recent transactions
(\`getSignaturesForAddress\`) and look for an m2m-split payment to that payee (memo
\`settled via m2m.monster <quote id>\`) since before the restart.

### Without the SDK

A signed payment is valid once and unlocks the resource once. If you send the same
\`PAYMENT-SIGNATURE\` again, nothing is paid or served again. The seller answers \`402\` with:

- body \`{"error":{"code":"QUOTE_EXPIRED","message":"This payment was already used."}}\`
- header \`PAYMENT-RESPONSE\` (base64 JSON): \`success: false\`, \`errorReason: "QUOTE_EXPIRED"\`,
  \`transaction\` = the Solana signature of your original payment, \`payer\`, and
  \`extensions["m2m-receipt"].info.receipt\` = the original signed receipt.

\`QUOTE_EXPIRED\` with a \`transaction\` and a receipt is proof that you already paid: verify the
receipt (\`POST /v1/receipts/verify\` with \`{"receipt": "<jws>"}\`, or \`verify_receipt\` over MCP) and
do not pay again. \`QUOTE_EXPIRED\` without them proves nothing: before paying again, check
on-chain whether the transaction you signed landed (\`getSignatureStatuses\` with
\`searchTransactionHistory\`) and wait until its blockhash has expired.

${
  network === DEVNET
    ? `## Try it on Devnet

\`GET ${base}/demo\` answers 402 with an m2m-split quote for 0.01 Devnet USDC (fee 0.001 USDC). Pay it with Devnet funds:

\`\`\`ts
const res = await pay("${base}/demo"); // createPaymentFetch from above, Devnet RPC and keys
console.log(res.status, await res.json()); // 200 and the receipt in PAYMENT-RESPONSE
\`\`\`

`
    : ""
}## Quote with curl

\`\`\`sh
curl -X POST ${api}/v1/quotes \\
  -H 'content-type: application/json' \\
  -H 'idempotency-key: 6f1c2e8a-quote-1' \\
  -d '{"network":"${network}","mint":"${usdc}","amount":"100000","payee":"YOUR_WALLET"}'
\`\`\`

## MCP

\`\`\`json
{ "mcpServers": { "m2m-monster": { "url": "${api}/mcp" } } }
\`\`\`

Tools: ${TOOLS.map(([id]) => `\`${id}\``).join(", ")}. Tools that move funds return unsigned transactions; sign them locally.

## Referrals

Register with \`referred_by\` (optional registration, challenge signed with your key). Referred agents get ${p.referral_program.referred_discount_percent}% off their fees for ${p.referral_program.referred_discount_days} days; referrers earn ${p.referral_program.referrer_credit_percent}% of the fees their referred agents pay, as non-cash credits on their own fees (combined discounts at most ${p.referral_program.max_combined_discount_percent}% of each fee, credits expire after ${p.referral_program.credit_expiry_months} months).

## Error codes

${Object.keys(ERRORS)
  .map((code) => `- \`${code}\``)
  .join("\n")}
`;
}

/** Public repository's GitHub private vulnerability reporting: the only security contact (D45, D62). */
export const SECURITY_REPORT_URL =
  "https://github.com/m2mmonster/m2m-monster/security/advisories/new";
const SECURITY_POLICY_URL = "https://github.com/m2mmonster/m2m-monster/security/policy";

/** RFC 9116 security.txt, production only. No e-mail address (D62). Expires 180 days ahead. */
export function securityTxt(base: string, now: number): string {
  const expires = new Date(now + 180 * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  return `Contact: ${SECURITY_REPORT_URL}
Expires: ${expires.toISOString()}
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
Policy: ${SECURITY_POLICY_URL}
`;
}

/** 64×64 icon for registries and catalogs. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="14" fill="#111"/><text x="32" y="41" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="22" font-weight="700" fill="#7CFFB2" text-anchor="middle">m2m</text></svg>`;

export function registerPublicRoutes(app: OpenAPIHono, deps: AppDeps) {
  const base = deps.publicBaseUrl;
  const api = deps.apiBaseUrl ?? base;
  app.get("/.well-known/mcp.json", (c) => {
    const ref = c.req.query("ref");
    return c.json(mcpManifest(base, ref && isAddress(ref) ? ref : undefined, api));
  });
  app.get("/.well-known/agent-card.json", (c) => c.json(agentCard(base, api)));
  app.get("/.well-known/x402.json", (c) => c.json(x402Info(deps.network, api)));
  app.get("/capabilities.json", (c) => c.json(capabilities(base, deps.network, api)));
  if (deps.network !== DEVNET) {
    app.get("/.well-known/security.txt", (c) =>
      c.text(securityTxt(base, deps.now()), 200, { "content-type": "text/plain; charset=utf-8" }),
    );
  }
  app.get("/terms.json", (c) => c.json(terms(base, deps.network)));
  app.get("/terms", (c) =>
    c.text(termsPage(base, deps.network), 200, { "content-type": "text/plain; charset=utf-8" }),
  );
  app.get("/discovery", (c) =>
    c.json({
      name: "m2m.monster",
      description: DESCRIPTION,
      network: deps.network,
      links: { ...urls(base, api), ...(deps.network === DEVNET && { demo: `${base}/demo` }) },
    }),
  );
  app.get("/icon.svg", (c) =>
    c.body(ICON_SVG, 200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    }),
  );
  app.get("/llms.txt", (c) =>
    c.text(agentDocs(base, deps.network, api), 200, {
      "content-type": "text/markdown; charset=utf-8",
    }),
  );
}
