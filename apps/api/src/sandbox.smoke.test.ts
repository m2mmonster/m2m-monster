// Smoke test against a deployed sandbox: SANDBOX_URL=https://... pnpm test:smoke
import { DEVNET, NETWORKS, type SignedQuote, verifyQuote } from "@m2m-monster/core";
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
      if (url.endsWith("/v1") || url.endsWith("/mcp")) continue;
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
