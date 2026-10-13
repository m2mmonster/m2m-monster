import { DEVNET, NETWORKS, registrationMessage, type SignedQuote } from "@m2m-monster/core";
import { type MockRpcState, signatureOf } from "@m2m-monster/core/testing";
import { getBase58Decoder, getUtf8Encoder, type KeyPairSigner, signBytes } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDeps } from "./app.js";
import { agents } from "./schema.js";
import { json, payerTransaction, signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc;
const DAY = 24 * 60 * 60 * 1000;

let app: Awaited<ReturnType<typeof testApp>>["app"];
let deps: AppDeps;
let state: MockRpcState;
let clock: { now: number };
let payer: KeyPairSigner;
let referrer: KeyPairSigner;
let referred: KeyPairSigner;

beforeEach(async () => {
  ({ app, deps, state, clock } = await testApp());
  [payer, referrer, referred] = await Promise.all([signer(1), signer(5), signer(6)]);
});

async function challenge(pubkey: string) {
  const res = await app.request("/v1/agents/challenge", json({ solana_pubkey: pubkey }));
  expect(res.status).toBe(201);
  return (await res.json()) as { nonce: string; expires_at: number };
}

async function sign(agent: KeyPairSigner, nonce: string) {
  const bytes = getUtf8Encoder().encode(registrationMessage(agent.address, nonce));
  return getBase58Decoder().decode(await signBytes(agent.keyPair.privateKey, bytes));
}

async function register(agent: KeyPairSigner, extra: Record<string, unknown> = {}) {
  const { nonce } = await challenge(agent.address);
  return app.request(
    "/v1/agents/register",
    json({
      agent_id: `agent-${agent.address.slice(0, 6)}`,
      solana_pubkey: agent.address,
      capabilities: ["weather"],
      signature: await sign(agent, nonce),
      ...extra,
    }),
  );
}

async function apiKeyOf(agent: KeyPairSigner, extra: Record<string, unknown> = {}) {
  const res = await register(agent, extra);
  expect(res.status).toBe(201);
  return ((await res.json()) as { api_key: string }).api_key;
}

async function quoteFor(payee: string, amount: string, apiKey?: string) {
  const res = await app.request(
    "/v1/quotes",
    json(
      { network: DEVNET, mint: USDC, amount, payee },
      {
        "idempotency-key": `q-${crypto.randomUUID()}`,
        ...(apiKey && { authorization: `Bearer ${apiKey}` }),
      },
    ),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as SignedQuote;
}

async function settle(quote: SignedQuote) {
  const { signed } = await payerTransaction(quote, payer);
  state.statuses.set(signatureOf(signed), { err: null, confirmationStatus: "confirmed" });
  const res = await app.request(
    "/v1/payments",
    json({ quote, transaction: signed }, { "idempotency-key": `p-${crypto.randomUUID()}` }),
  );
  expect(res.status).toBe(201);
  return res.json();
}

const referralStatus = async (apiKey: string) =>
  (await app
    .request("/v1/agents/me/referrals", {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    .then((r) => r.json())) as {
    referrer: string | null;
    referred: { pubkey: string; activated_at: number | null }[];
    credits: { amount: string; remaining: string; accrued_at: number; expires_at: number }[];
    available_credits: string;
    referred_discount_until: number | null;
  };

describe("challenge-signed registration (section D)", () => {
  it("returns an api_key, stored only as a hash, and an MCP config", async () => {
    const res = await register(referrer);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { api_key: string; mcp: { url: string; headers: object } };
    expect(body.api_key).toMatch(/^m2m_[1-9A-HJ-NP-Za-km-z]{40,}$/);
    expect(body.mcp).toEqual({
      url: "https://m2m.monster/mcp",
      headers: { Authorization: `Bearer ${body.api_key}` },
    });
    const rows = await deps.db.select().from(agents);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(body.api_key);
  });

  it("rejects a signature from another key (CHALLENGE_INVALID)", async () => {
    const { nonce } = await challenge(referrer.address);
    const res = await app.request(
      "/v1/agents/register",
      json({
        agent_id: "x",
        solana_pubkey: referrer.address,
        signature: await sign(referred, nonce),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "CHALLENGE_INVALID" } });
  });

  it("rejects a nonce used twice", async () => {
    const { nonce } = await challenge(referrer.address);
    const body = {
      agent_id: "x",
      solana_pubkey: referrer.address,
      signature: await sign(referrer, nonce),
    };
    expect((await app.request("/v1/agents/register", json(body))).status).toBe(201);
    const again = await app.request("/v1/agents/register", json(body));
    expect(await again.json()).toMatchObject({ error: { code: "CHALLENGE_INVALID" } });
  });

  it("rejects an expired challenge", async () => {
    const { nonce, expires_at } = await challenge(referrer.address);
    clock.now = (expires_at + 1) * 1000;
    const res = await app.request(
      "/v1/agents/register",
      json({
        agent_id: "x",
        solana_pubkey: referrer.address,
        signature: await sign(referrer, nonce),
      }),
    );
    expect(await res.json()).toMatchObject({ error: { code: "CHALLENGE_INVALID" } });
  });

  it("rejects an unknown referrer and self-referral", async () => {
    const unknown = await register(referred, { referred_by: payer.address });
    expect(await unknown.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    const self = await register(referred, { referred_by: referred.address });
    expect(await self.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("keeps the referrer permanent and rotates the api_key on re-registration", async () => {
    await apiKeyOf(referrer);
    await apiKeyOf(payer);
    const first = await apiKeyOf(referred, { referred_by: referrer.address });
    const changed = await register(referred, { referred_by: payer.address });
    expect(await changed.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    const second = await apiKeyOf(referred);
    expect(second).not.toBe(first);
    expect((await referralStatus(second)).referrer).toBe(referrer.address);
    const old = await app.request("/v1/agents/me/referrals", {
      headers: { authorization: `Bearer ${first}` },
    });
    expect(old.status).toBe(401);
    expect(await old.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });
});

describe("referral discounts and credits (section C, D2–D6)", () => {
  it("gives the referred payee 25% off, only on its own authenticated quotes", async () => {
    const referrerKey = await apiKeyOf(referrer);
    const referredKey = await apiKeyOf(referred, { referred_by: referrer.address });

    expect(await quoteFor(referred.address, "10000000", referredKey)).toMatchObject({
      fee_gross: "25000",
      discount: "6250",
      fee_net: "18750",
      payee_amount: "9981250",
    });
    expect(await quoteFor(referred.address, "10000000")).toMatchObject({ discount: "0" });
    expect(await quoteFor(referred.address, "10000000", referrerKey)).toMatchObject({
      discount: "0",
    });
  });

  it("ends the referred discount 90 days after the first settlement", async () => {
    await apiKeyOf(referrer);
    const key = await apiKeyOf(referred, { referred_by: referrer.address });
    await settle(await quoteFor(referred.address, "1000000", key));
    clock.now += 90 * DAY;
    expect(await quoteFor(referred.address, "10000000", key)).toMatchObject({ discount: "0" });
  });

  it("accrues 10% of fee_net to the referrer after activation, and spends it as discount", async () => {
    const referrerKey = await apiKeyOf(referrer);
    const referredKey = await apiKeyOf(referred, { referred_by: referrer.address });

    // $10 settled as payee activates the referred agent; that fee generates no credit.
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    let status = await referralStatus(referrerKey);
    expect(status.referred).toEqual([
      {
        pubkey: referred.address,
        activated_at: clock.now / 1000,
        registered_at: expect.any(Number),
      },
    ]);
    expect(status.credits).toEqual([]);

    // After activation: 10% of fee_net 18750 = 1875.
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    status = await referralStatus(referrerKey);
    expect(status.available_credits).toBe("1875");
    expect(status.credits).toEqual([
      {
        amount: "1875",
        remaining: "1875",
        accrued_at: clock.now / 1000,
        expires_at: Date.UTC(2027, 9, 8, 11, 46, 40) / 1000,
      },
    ]);

    // The referrer spends the credit on its own fee; a concurrent quote cannot reuse it.
    const own = await quoteFor(referrer.address, "10000000", referrerKey);
    expect(own).toMatchObject({ fee_gross: "25000", discount: "1875", fee_net: "23125" });
    expect(await quoteFor(referrer.address, "10000000", referrerKey)).toMatchObject({
      discount: "0",
    });
    await settle(own);
    status = await referralStatus(referrerKey);
    expect(status.available_credits).toBe("0");
    expect(status.credits[0]?.remaining).toBe("0");
  });

  it("releases reserved credits when a quote expires unused", async () => {
    const referrerKey = await apiKeyOf(referrer);
    const referredKey = await apiKeyOf(referred, { referred_by: referrer.address });
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    await quoteFor(referrer.address, "10000000", referrerKey);
    clock.now += 5 * 60 * 1000;
    expect(await quoteFor(referrer.address, "10000000", referrerKey)).toMatchObject({
      discount: "1875",
    });
  });

  it("expires credits 12 months after accrual", async () => {
    const referrerKey = await apiKeyOf(referrer);
    const referredKey = await apiKeyOf(referred, { referred_by: referrer.address });
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    await settle(await quoteFor(referred.address, "10000000", referredKey));
    clock.now += 366 * DAY;
    expect((await referralStatus(referrerKey)).available_credits).toBe("0");
    expect(await quoteFor(referrer.address, "10000000", referrerKey)).toMatchObject({
      discount: "0",
    });
  });

  it("generates no credits from agents that only pay", async () => {
    const referrerKey = await apiKeyOf(referrer);
    await apiKeyOf(payer, { referred_by: referrer.address });
    const payee = await signer(7);
    for (let i = 0; i < 3; i++) await settle(await quoteFor(payee.address, "10000000"));
    expect((await referralStatus(referrerKey)).credits).toEqual([]);
  });
});

describe("receipt history (section D)", () => {
  it("lists the agent's receipts as payer or payee, newest first", async () => {
    const key = await apiKeyOf(referred);
    const a = await quoteFor(referred.address, "1000000");
    await settle(a);
    clock.now += 1000;
    const b = await quoteFor(referred.address, "2000000");
    await settle(b);
    await settle(await quoteFor(referrer.address, "1000000"));
    const res = await app.request("/v1/agents/me/receipts", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { receipts: { receipt_data: { id: string } }[] };
    expect(body.receipts.map((r) => r.receipt_data.id)).toEqual([b.id, a.id]);
  });

  it("requires an api_key", async () => {
    const res = await app.request("/v1/agents/me/receipts");
    expect(res.status).toBe(401);
  });
});

describe("SDK client (packages/sdk-ts)", () => {
  it("registers by signing the challenge locally, then reads referral status and history", async () => {
    const { createApiClient } = await import("@m2m-monster/sdk");
    const fetch = (request: Request) => app.fetch(request);
    const anonymous = createApiClient("http://api.test", { fetch });
    await anonymous.register({ signer: referrer, agentId: "referrer" });
    const { api_key, mcp } = await anonymous.register({
      signer: referred,
      agentId: "referred",
      capabilities: ["translate"],
      referredBy: referrer.address,
    });
    expect(mcp.headers.Authorization).toBe(`Bearer ${api_key}`);

    const client = createApiClient("http://api.test", { fetch, apiKey: api_key });
    const status = await client.referralStatus();
    expect(status).toMatchObject({ referrer: referrer.address, available_credits: "0" });
    const quote = await client.requestQuote(
      { network: DEVNET, mint: USDC, amount: "10000000", payee: referred.address },
      "sdk-quote-123456",
    );
    expect(quote).toMatchObject({ discount: "6250", fee_net: "18750" });
    await settle(quote);
    const history = await client.receiptHistory();
    expect(history.receipts.map((r) => r.signature)).toHaveLength(1);
  });
});
