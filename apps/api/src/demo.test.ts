// Devnet demo resource behind a 402 (sections B, C, G, K, M; D48).
import {
  associatedTokenAccount,
  DEVNET,
  decodeHeader,
  encodeHeader,
  MAINNET,
  NETWORKS,
  type PaymentRequired,
  paymentRequired,
  type SignedQuote,
} from "@m2m-monster/core";
import { type MockRpcState, putTokenAccount } from "@m2m-monster/core/testing";
import { createPaymentFetch, m2mSplitSchemeClient, settlementOf } from "@m2m-monster/sdk";
import type { Address, KeyPairSigner } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDeps } from "./app.js";
import { DEMO_PAYEE, DEMO_PRICE } from "./demo.js";
import { json, signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;
const URL_ = "https://sandbox.m2m.monster/demo";

let app: Awaited<ReturnType<typeof testApp>>["app"];
let deps: AppDeps;
let state: MockRpcState;
let payer: KeyPairSigner;

beforeEach(async () => {
  ({ app, deps, state } = await testApp({ now: Date.now }));
  state.autoConfirm = true;
  payer = await signer(1);
  for (const [owner, balance] of [
    [payer.address, 10_000_000n],
    [DEMO_PAYEE as Address, 0n],
    [TREASURY, 0n],
  ] as const) {
    putTokenAccount(state, await associatedTokenAccount(owner, USDC), owner, USDC, balance);
  }
});

const required = async () => {
  const res = await app.request(URL_);
  return { res, body: decodeHeader<PaymentRequired>(res.headers.get("PAYMENT-REQUIRED") ?? "") };
};

describe("GET /demo (Devnet only)", () => {
  it("answers 402 with m2m-split, Devnet USDC, the referral link and a 30-second quote", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { res, body } = await required();
    expect(res.status).toBe(402);
    expect(DEMO_PRICE).toEqual({ mint: USDC, amount: "10000" });
    expect(body.accepts).toHaveLength(1);
    const [accepted] = body.accepts;
    expect(accepted).toMatchObject({
      scheme: "m2m-split",
      network: DEVNET,
      asset: USDC,
      amount: "10000",
      payTo: DEMO_PAYEE,
      maxTimeoutSeconds: 30,
      extra: {
        fee_gross: "1000",
        discount: "0",
        fee_net: "1000",
        payee_amount: "9000",
        treasury: TREASURY,
        usdc_mint: USDC,
        paymentFlow: "upfront",
      },
    });
    const expires = accepted?.extra?.expires_at as number;
    expect(expires - before).toBeGreaterThanOrEqual(29);
    expect(expires - before).toBeLessThanOrEqual(31);
    expect(body.extensions?.["m2m-referral"]?.info.link).toBe(
      `https://m2m.monster/.well-known/mcp.json?ref=${DEMO_PAYEE}`,
    );
    expect(body.extensions?.["payment-identifier"]?.info).toEqual({ required: true });
  });

  it("serves the resource once paid, through the relay, with a receipt", async () => {
    const pay = createPaymentFetch({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
      fetch: (request) => Promise.resolve(app.fetch(request)),
    });
    const res = await pay(URL_);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ demo: true, network: DEVNET });
    const settlement = settlementOf(res);
    expect(settlement).toMatchObject({ success: true, payer: payer.address, amount: "10000" });
    expect(settlement?.extensions?.["m2m-receipt"]?.info.receipt).toEqual(expect.any(String));
    expect(state.sent).toHaveLength(1);
  });

  it("rejects a valid quote for another price", async () => {
    const res402 = await app.request(
      "/v1/quotes",
      json(
        { network: DEVNET, mint: USDC, amount: "1000", payee: DEMO_PAYEE },
        { "idempotency-key": "cheaper-quote-123" },
      ),
    );
    const cheap = (await res402.json()) as SignedQuote;
    const required = paymentRequired(cheap, { url: URL_ });
    const scheme = m2mSplitSchemeClient({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
    });
    const paid = await scheme.createPaymentPayload(2, required.accepts[0] as never, {
      extensions: required.extensions as never,
    });
    const res = await app.request(URL_, {
      headers: {
        "PAYMENT-SIGNATURE": encodeHeader({
          x402Version: 2,
          accepted: required.accepts[0],
          ...paid,
        }),
      },
    });
    expect(res.status).toBe(402);
    expect(settlementOf(res)).toMatchObject({
      success: false,
      errorReason: "PAYMENT_TRANSACTION_INVALID",
    });
    expect(state.sent).toHaveLength(0);
  });

  it("does not exist outside Devnet", async () => {
    const mainnet = await testApp({ network: MAINNET, treasury: "unused" });
    expect((await mainnet.app.request(URL_)).status).toBe(404);
  });
});
