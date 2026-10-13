import {
  DEVNET,
  NETWORKS,
  type SignedQuote,
  splitExpectation,
  verifyQuote,
} from "@m2m-monster/core";
import { mockRpc } from "@m2m-monster/core/testing";
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from "@solana/kit";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, createApp } from "./app.js";
import type { Db } from "./db.js";
import { memoryKv } from "./kv.js";
import { testDb } from "./test-db.js";

const USDC = NETWORKS[DEVNET].usdc;
const PAYEE = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";
const OTHER_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

let clock: number;
let deps: AppDeps;
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  clock = 1_791_460_000_000;
  const serviceKeys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9), true);
  deps = {
    network: DEVNET,
    treasury: NETWORKS[DEVNET].treasury as string,
    serviceKeys,
    serviceAddress: await getAddressFromPublicKey(serviceKeys.publicKey),
    kv: memoryKv(() => clock),
    db,
    rpc: mockRpc().rpc,
    mintDecimals: async () => 6,
    now: () => clock,
    publicBaseUrl: "https://m2m.monster",
    clientIp: () => "203.0.113.7",
    limits: { ip: 1000, pubkey: 1000, apiKey: 1000 },
  };
  app = createApp(deps);
});

let keyCounter = 0;
const quoteRequest = (
  body: Record<string, unknown>,
  idempotencyKey = `key-${++keyCounter}-abcdefgh`,
) =>
  app.request("/v1/quotes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      network: DEVNET,
      mint: USDC,
      amount: "10000000",
      payee: PAYEE,
      ...body,
    }),
  });

describe("POST /v1/quotes", () => {
  it("returns a signed quote with the fee breakdown (sections C, F, G)", async () => {
    const res = await quoteRequest({});
    expect(res.status).toBe(201);
    const quote = (await res.json()) as SignedQuote;
    expect(quote).toMatchObject({
      network: DEVNET,
      mint: USDC,
      decimals: 6,
      amount: "10000000",
      payee: PAYEE,
      payee_amount: "9975000",
      treasury: NETWORKS[DEVNET].treasury,
      usdc_mint: USDC,
      usdc_decimals: 6,
      fee_gross: "25000",
      discount: "0",
      fee_net: "25000",
      expires_at: clock / 1000 + 30,
      referral: `https://m2m.monster/.well-known/mcp.json?ref=${PAYEE}`,
    });
    expect(quote.id).toMatch(/^q_[1-9A-HJ-NP-Za-km-z]{16,}$/);
    expect(quote.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(await verifyQuote(quote, deps.serviceAddress)).toBe(true);
    expect(splitExpectation(quote).payeeAmount).toBe(9_975_000n);
  });

  it("gives every quote a fresh id and nonce", async () => {
    const a = (await (await quoteRequest({})).json()) as SignedQuote;
    const b = (await (await quoteRequest({})).json()) as SignedQuote;
    expect(a.id).not.toBe(b.id);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("returns the same quote for a retried idempotency key (section K)", async () => {
    const first = await (await quoteRequest({}, "retry-key-12345678")).json();
    clock += 60_000;
    const retry = await quoteRequest({}, "retry-key-12345678");
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
  });

  it("rejects an idempotency key reused for a different request", async () => {
    await quoteRequest({}, "reused-key-12345678");
    const res = await quoteRequest({ amount: "20000000" }, "reused-key-12345678");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it("requires an idempotency key", async () => {
    const res = await app.request("/v1/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: DEVNET, mint: USDC, amount: "10000000", payee: PAYEE }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects payments below $0.001 (PAYMENT_BELOW_MINIMUM)", async () => {
    const res = await quoteRequest({ amount: "999" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_BELOW_MINIMUM" } });
  });

  it("accepts the $0.001 minimum, with the whole amount as fee", async () => {
    const res = await quoteRequest({ amount: "1000" });
    expect(await res.json()).toMatchObject({ fee_net: "1000", payee_amount: "0" });
  });

  it("rejects mints outside the network whitelist (MINT_NOT_ALLOWED)", async () => {
    const res = await quoteRequest({ mint: OTHER_MINT });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "MINT_NOT_ALLOWED" } });
  });

  it("rejects another network than the one this deployment serves", async () => {
    const res = await quoteRequest({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it.each([
    ["a non-integer amount", { amount: "1.5" }],
    ["a negative amount", { amount: "-1000" }],
    ["an amount above u64", { amount: "18446744073709551616" }],
    ["an invalid payee", { payee: "not-a-pubkey" }],
  ])("rejects %s", async (_name, body) => {
    const res = await quoteRequest(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});

describe("rate limiting (section K)", () => {
  it("limits per IP", async () => {
    app = createApp({ ...deps, limits: { ...deps.limits, ip: 2 } });
    expect((await quoteRequest({})).status).toBe(201);
    expect((await quoteRequest({})).status).toBe(201);
    const res = await quoteRequest({});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    clock += 60_000;
    expect((await quoteRequest({})).status).toBe(201);
  });

  it("limits per payee pubkey", async () => {
    app = createApp({ ...deps, limits: { ...deps.limits, pubkey: 1 } });
    expect((await quoteRequest({})).status).toBe(201);
    expect((await quoteRequest({})).status).toBe(429);
    expect(
      (await quoteRequest({ payee: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse" })).status,
    ).toBe(201);
  });

  it("limits per api_key", async () => {
    app = createApp({ ...deps, limits: { ...deps.limits, apiKey: 1 } });
    const call = (key: string) =>
      app.request("/v1/errors", { headers: { authorization: `Bearer ${key}` } });
    expect((await call("key-a")).status).toBe(200);
    expect((await call("key-a")).status).toBe(429);
    expect((await call("key-b")).status).toBe(200);
  });
});

describe("public endpoints", () => {
  it("GET /v1/errors lists the stable error codes", async () => {
    const res = await app.request("/v1/errors");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      PAYMENT_BELOW_MINIMUM: expect.any(String),
      FEE_BALANCE_INSUFFICIENT_USDC: expect.any(String),
    });
  });

  it("GET /v1/service-key returns the address that signs quotes and receipts", async () => {
    const res = await app.request("/v1/service-key");
    expect(await res.json()).toEqual({ address: deps.serviceAddress });
  });

  it("serves the OpenAPI 3.1 document", async () => {
    const res = await app.request("/v1/openapi.json");
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/quotes", "/v1/errors", "/v1/service-key"]),
    );
  });
});
