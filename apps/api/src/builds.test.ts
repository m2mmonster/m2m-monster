import {
  associatedTokenAccount,
  DEVNET,
  NETWORKS,
  type SignedQuote,
  signSplitTransaction,
} from "@m2m-monster/core";
import { type MockRpcState, putTokenAccount } from "@m2m-monster/core/testing";
import {
  type Address,
  getBase64Encoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { json, signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;

let app: Awaited<ReturnType<typeof testApp>>["app"];
let state: MockRpcState;
let payer: KeyPairSigner;
let payee: KeyPairSigner;
let quote: SignedQuote;

const signaturesOf = (wire: string) =>
  getTransactionDecoder().decode(getBase64Encoder().encode(wire)).signatures;

beforeEach(async () => {
  ({ app, state } = await testApp({ now: Date.now }));
  state.autoConfirm = true;
  payer = await signer(1);
  payee = await signer(2);
  for (const [owner, balance] of [
    [payer.address, 10_000_000n],
    [payee.address, 10_000_000n],
    [TREASURY, 0n],
  ] as const) {
    putTokenAccount(state, await associatedTokenAccount(owner, USDC), owner, USDC, balance);
  }
  const res = await app.request(
    "/v1/quotes",
    json(
      { network: DEVNET, mint: USDC, amount: "100000", payee: payee.address },
      { "idempotency-key": `q-${crypto.randomUUID()}` },
    ),
  );
  quote = (await res.json()) as SignedQuote;
});

const post = async (path: string, body: unknown, headers = {}) => {
  const res = await app.request(path, json(body, headers));
  return { status: res.status, body: (await res.json()) as Record<string, never> };
};

describe("unsigned builds (rule 4)", () => {
  it("POST /v1/payments/build returns the m2m-split unsigned", async () => {
    const { status, body } = await post("/v1/payments/build", { quote, payer: payer.address });
    expect(status).toBe(200);
    expect(Object.values(signaturesOf(body.transaction))).toEqual([null]);
    expect(body).toMatchObject({ compute_unit_limit: 7200, compute_unit_price: "0" });
  });

  it("POST /v1/payments/build refuses without USDC for the fee", async () => {
    const broke = await signer(8);
    const { body } = await post("/v1/payments/build", { quote, payer: broke.address });
    expect(body).toMatchObject({ error: { code: "FEE_BALANCE_INSUFFICIENT_USDC" } });
  });

  it("POST /v1/payments/verify accepts the payer-signed transaction", async () => {
    const built = await post("/v1/payments/build", { quote, payer: payer.address });
    const signed = await signSplitTransaction(built.body.transaction, payer.keyPair);
    const { status, body } = await post("/v1/payments/verify", { quote, transaction: signed });
    expect(status).toBe(200);
    expect(body).toMatchObject({ valid: true, payer: payer.address });
    const unsigned = await post("/v1/payments/verify", {
      quote,
      transaction: built.body.transaction,
    });
    expect(unsigned.body).toMatchObject({ error: { code: "PAYMENT_TRANSACTION_INVALID" } });
  });

  it("POST /v1/refunds/build returns an unsigned refund for the payee", async () => {
    const built = await post("/v1/payments/build", { quote, payer: payer.address });
    const signed = await signSplitTransaction(built.body.transaction, payer.keyPair);
    const settled = await post(
      "/v1/payments",
      { quote, transaction: signed },
      { "idempotency-key": `p-${crypto.randomUUID()}` },
    );
    const { status, body } = await post("/v1/refunds/build", {
      receipt: settled.body.receipt,
      amount: "50000",
    });
    expect(status).toBe(200);
    expect(Object.keys(signaturesOf(body.transaction))).toEqual([payee.address]);
    expect(Object.values(signaturesOf(body.transaction))).toEqual([null]);

    const tooMuch = await post("/v1/refunds/build", {
      receipt: settled.body.receipt,
      amount: "100001",
    });
    expect(tooMuch.body).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    const forged = await post("/v1/refunds/build", { receipt: "a.b.c", amount: "1" });
    expect(forged.body).toMatchObject({ error: { code: "RECEIPT_INVALID" } });
  });

  it("GET /status.json reports the API version and network", async () => {
    const res = await app.request("/status.json");
    expect(await res.json()).toMatchObject({ status: "ok", api_version: "v1", network: DEVNET });
  });
});
