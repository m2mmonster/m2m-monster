// Smoke test against a deployed sandbox: SANDBOX_URL=https://... pnpm test:smoke
import {
  DEVNET,
  decodeHeader,
  NETWORKS,
  type PaymentRequired,
  type SignedQuote,
  verifyQuote,
} from "@m2m-monster/core";
import { describe, expect, it } from "vitest";

const base = process.env.SANDBOX_URL?.replace(/\/$/, "");
if (!base) throw new Error("Set SANDBOX_URL to the deployed sandbox, e.g. https://sandbox.example");

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`);
  expect(res.status, path).toBe(200);
  return res;
};

describe(`deployed sandbox ${base}`, () => {
  it("reports Devnet status and serves the public files", async () => {
    const status = (await (await get("/status.json")).json()) as Record<string, string>;
    expect(status).toMatchObject({ status: "ok", api_version: "v1", network: DEVNET });
    const discovery = (await (await get("/discovery")).json()) as { links: Record<string, string> };
    for (const url of Object.values(discovery.links)) {
      // /v1 is a prefix, /mcp needs POST and /demo answers 402 (checked below).
      if (url.endsWith("/v1") || url.endsWith("/mcp") || url.endsWith("/demo")) continue;
      expect((await fetch(url)).status, url).toBe(200);
    }
  });

  it("issues a signed quote with the section F fee", async () => {
    const res = await fetch(`${base}/v1/quotes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `smoke-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        network: DEVNET,
        mint: NETWORKS[DEVNET].usdc,
        amount: "10000000",
        payee: NETWORKS[DEVNET].treasury,
      }),
    });
    expect(res.status).toBe(201);
    const quote = (await res.json()) as SignedQuote;
    expect(quote).toMatchObject({ fee_gross: "25000", fee_net: "25000", payee_amount: "9975000" });
    const { address } = (await (await get("/v1/service-key")).json()) as { address: string };
    expect(await verifyQuote(quote, address)).toBe(true);
  });

  it("serves the Devnet demo 402 with m2m-split and a 30-second quote", async () => {
    const res = await fetch(`${base}/demo`);
    expect(res.status).toBe(402);
    const required = decodeHeader<PaymentRequired>(res.headers.get("PAYMENT-REQUIRED") ?? "");
    const [accepted] = required.accepts;
    expect(accepted).toMatchObject({
      scheme: "m2m-split",
      network: DEVNET,
      asset: NETWORKS[DEVNET].usdc,
      amount: "10000",
      extra: { fee_net: "1000", payee_amount: "9000" },
    });
    // Measured against the server's own clock (Date header), not this machine's.
    const serverNow = Math.floor(Date.parse(res.headers.get("date") ?? "") / 1000);
    const ttl = (accepted?.extra?.expires_at as number) - serverNow;
    expect(ttl).toBeGreaterThanOrEqual(29);
    expect(ttl).toBeLessThanOrEqual(31);
    expect(required.extensions?.["m2m-referral"]?.info.link).toContain(`ref=${accepted?.payTo}`);
    expect(required.resource.url).toBe(`${base}/demo`);
  });

  it("answers MCP tools/list", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
  });
});
