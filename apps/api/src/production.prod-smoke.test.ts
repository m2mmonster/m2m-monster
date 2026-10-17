// Read-only smoke test against the production deployment. It never pays: it imports no signer,
// builds no transaction and sends nothing on-chain (tests never use real funds, rule 11).
//   PROD_URL=https://m2m.monster PROD_API_URL=https://api.m2m.monster pnpm test:smoke:prod
// The only write is one quote, which counts in the daily usage summary (D44).
import { MAINNET, NETWORKS, type SignedQuote, verifyQuote } from "@m2m-monster/core";
import { describe, expect, it } from "vitest";

const base = process.env.PROD_URL?.replace(/\/$/, "");
const api = (process.env.PROD_API_URL ?? process.env.PROD_URL)?.replace(/\/$/, "");
if (!base || !api) throw new Error("Set PROD_URL (and PROD_API_URL if different)");

const MAINNET_MINTS = [
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
];

const get = async (url: string) => {
  const res = await fetch(url);
  expect(res.status, url).toBe(200);
  return res;
};
const getJson = async (url: string) => (await (await get(url)).json()) as Record<string, never>;

describe(`production ${base} / ${api} (read-only)`, () => {
  it("reports mainnet status with a service key", async () => {
    const status = await getJson(`${api}/status.json`);
    expect(status).toMatchObject({ status: "ok", api_version: "v1", network: MAINNET });
    expect(status.service_key).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("publishes the exact mainnet mints and the section F fee", async () => {
    const pricing = await getJson(`${base}/pricing.json`);
    expect(pricing).toMatchObject({
      network: { id: MAINNET, tokens: MAINNET_MINTS },
      agent_to_agent: { formula: "fee = min(max(0.25% × amount, $0.001), $0.5)" },
    });
  });

  it("serves the approved terms without a draft mark, on /terms.json and /terms", async () => {
    const terms = (await getJson(`${base}/terms.json`)) as unknown as Record<string, string>;
    expect(terms).toMatchObject({ language: "en", pricing: `${base}/pricing.json` });
    expect(terms).not.toHaveProperty("status");
    expect(JSON.stringify(terms)).not.toMatch(/\bdraft\b|pending legal review/i);
    expect(await (await get(`${base}/terms`)).text()).toBe(terms.text);
  });

  it("serves security.txt with GitHub private reporting as the only contact", async () => {
    const text = await (await get(`${base}/.well-known/security.txt`)).text();
    expect(text).toContain(
      "Contact: https://github.com/m2mmonster/m2m-monster/security/advisories/new",
    );
    expect(text).not.toMatch(/@|mailto/i);
  });

  it("serves every public file over https only, and no Devnet demo", async () => {
    const discovery = await getJson(`${base}/discovery`);
    const links = discovery.links as unknown as Record<string, string>;
    expect(links.demo).toBeUndefined();
    expect(links.mcp).toBe(`${api}/mcp`);
    for (const url of Object.values(links)) {
      if (url.endsWith("/v1") || url.endsWith("/mcp")) continue;
      const text = await (await get(url)).text();
      expect(text, url).not.toContain("http://");
    }
    expect((await fetch(`${base}/demo`)).status).toBe(404);
  });

  it("issues a signed quote with the section F fee (no transaction is built)", async () => {
    const usdc = NETWORKS[MAINNET].usdc;
    const res = await fetch(`${api}/v1/quotes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `prod-smoke-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        network: MAINNET,
        mint: usdc,
        amount: "10000000",
        payee: "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
      }),
    });
    expect(res.status).toBe(201);
    const quote = (await res.json()) as SignedQuote;
    expect(quote).toMatchObject({ fee_gross: "25000", fee_net: "25000", payee_amount: "9975000" });
    const { address } = (await getJson(`${api}/v1/service-key`)) as unknown as { address: string };
    expect(await verifyQuote(quote, address)).toBe(true);
  });

  it("answers MCP tools/list with the ten section L tools", async () => {
    const res = await fetch(`${api}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(10);
  });
});
