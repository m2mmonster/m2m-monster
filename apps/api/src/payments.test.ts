import { DEVNET, NETWORKS, type SignedQuote, verifyReceiptSignature } from "@m2m-monster/core";
import { type MockRpcState, signatureOf } from "@m2m-monster/core/testing";
import type { KeyPairSigner } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDeps } from "./app.js";
import { json, payerTransaction, signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc;

let app: Awaited<ReturnType<typeof testApp>>["app"];
let deps: AppDeps;
let state: MockRpcState;
let clock: { now: number };
let payer: KeyPairSigner;
let payee: KeyPairSigner;
let quote: SignedQuote;

beforeEach(async () => {
  ({ app, deps, state, clock } = await testApp());
  payer = await signer(1);
  payee = await signer(2);
  const res = await app.request(
    "/v1/quotes",
    json(
      { network: DEVNET, mint: USDC, amount: "10000000", payee: payee.address },
      { "idempotency-key": `quote-${crypto.randomUUID()}` },
    ),
  );
  quote = (await res.json()) as SignedQuote;
});

const confirmOnChain = (wire: string) =>
  state.statuses.set(signatureOf(wire), { err: null, confirmationStatus: "confirmed" });

const submit = (body: unknown, key = `pay-${crypto.randomUUID()}`) =>
  app.request("/v1/payments", json(body, { "idempotency-key": key }));

describe("POST /v1/payments: relay (sections G, K; L submit_payment)", () => {
  it("verifies, simulates, broadcasts and returns a signed receipt", async () => {
    const { signed } = await payerTransaction(quote, payer);
    confirmOnChain(signed);
    const res = await submit({ quote, transaction: signed });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      signature: string;
      receipt: string;
      receipt_data: unknown;
    };
    expect(body.signature).toBe(signatureOf(signed));
    expect(state.sent).toEqual([signed]);
    expect(state.simulated.at(-1)?.config).toMatchObject({ sigVerify: true });

    const receipt = await verifyReceiptSignature(body.receipt, deps.serviceAddress);
    expect(receipt).toMatchObject({
      id: quote.id,
      transaction: body.signature,
      payer: payer.address,
      payee: payee.address,
      fee_gross: "25000",
      discount: "0",
      fee_net: "25000",
      issued_at: clock.now / 1000,
    });
    expect(body.receipt_data).toEqual(receipt);
  });

  it("returns the same result for a retried idempotency key, broadcasting once", async () => {
    const { signed } = await payerTransaction(quote, payer);
    confirmOnChain(signed);
    const first = await (await submit({ quote, transaction: signed }, "pay-retry-1234")).json();
    const retry = await submit({ quote, transaction: signed }, "pay-retry-1234");
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
    expect(state.sent).toHaveLength(1);
  });

  it("accepts a quote only once (QUOTE_EXPIRED)", async () => {
    const { signed } = await payerTransaction(quote, payer);
    confirmOnChain(signed);
    expect((await submit({ quote, transaction: signed })).status).toBe(201);
    const again = await submit({ quote, transaction: signed });
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ error: { code: "QUOTE_EXPIRED" } });
  });

  it("rejects an unsigned transaction and never broadcasts it", async () => {
    const { unsigned } = await payerTransaction(quote, payer);
    const res = await submit({ quote, transaction: unsigned });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_TRANSACTION_INVALID" } });
    expect(state.sent).toEqual([]);
  });

  it("rejects a transaction that deviates from the quote", async () => {
    const { signed } = await payerTransaction(quote, payer, { feeNet: 1_000n });
    const res = await submit({ quote, transaction: signed });
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_TRANSACTION_INVALID" } });
    expect(state.sent).toEqual([]);
  });

  it("rejects an expired quote", async () => {
    const { signed } = await payerTransaction(quote, payer);
    clock.now += 31_000;
    const res = await submit({ quote, transaction: signed });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: "QUOTE_EXPIRED" } });
  });

  it("rejects a quote not signed by the service key", async () => {
    const { signed } = await payerTransaction(quote, payer);
    const res = await submit({ quote: { ...quote, fee_net: "1" }, transaction: signed });
    expect(await res.json()).toMatchObject({ error: { code: "QUOTE_INVALID" } });
  });

  it("does not broadcast when simulation fails", async () => {
    const { signed } = await payerTransaction(quote, payer);
    state.simulation = { err: "BlockhashNotFound", logs: [] };
    const res = await submit({ quote, transaction: signed });
    expect(await res.json()).toMatchObject({ error: { code: "SIMULATION_FAILED" } });
    expect(state.sent).toEqual([]);
  });
});

describe("receipts", () => {
  it("GET /v1/receipts/{id} returns a stored receipt", async () => {
    const { signed } = await payerTransaction(quote, payer);
    confirmOnChain(signed);
    const paid = (await (await submit({ quote, transaction: signed })).json()) as {
      receipt: string;
    };
    const res = await app.request(`/v1/receipts/${quote.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ receipt: paid.receipt });
    const missing = await app.request("/v1/receipts/q_missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("POST /v1/receipts issues a receipt for a payment the payee submitted itself (D8)", async () => {
    const { signed } = await payerTransaction(quote, payer);
    state.transactions.set(signatureOf(signed), { wire: signed, err: null });
    const body = { quote, signature: signatureOf(signed) };
    const res = await app.request("/v1/receipts", json(body));
    expect(res.status).toBe(201);
    const first = (await res.json()) as { receipt: string };
    const receipt = await verifyReceiptSignature(first.receipt, deps.serviceAddress);
    expect(receipt).toMatchObject({
      id: quote.id,
      payer: payer.address,
      transaction: signatureOf(signed),
    });
    const again = await app.request("/v1/receipts", json(body));
    expect(await again.json()).toEqual(first);
  });

  it("POST /v1/receipts rejects a transaction that is not on-chain", async () => {
    const { signed } = await payerTransaction(quote, payer);
    const res = await app.request("/v1/receipts", json({ quote, signature: signatureOf(signed) }));
    expect(res.status).toBe(404);
  });

  it("POST /v1/receipts rejects a transaction that does not match the quote", async () => {
    const { signed } = await payerTransaction(quote, payer, { payeeAmount: 1n });
    state.transactions.set(signatureOf(signed), { wire: signed, err: null });
    const res = await app.request("/v1/receipts", json({ quote, signature: signatureOf(signed) }));
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_TRANSACTION_INVALID" } });
  });

  it("POST /v1/receipts/verify checks a receipt against the chain (verify_receipt)", async () => {
    const { signed } = await payerTransaction(quote, payer);
    confirmOnChain(signed);
    state.transactions.set(signatureOf(signed), { wire: signed, err: null });
    const { receipt } = (await (await submit({ quote, transaction: signed })).json()) as {
      receipt: string;
    };
    const ok = await app.request("/v1/receipts/verify", json({ receipt }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      valid: true,
      receipt_data: { id: quote.id },
      slot: "7",
    });

    const [h, , s] = receipt.split(".");
    const forged = Buffer.from(JSON.stringify({ id: quote.id, fee_net: "1" })).toString(
      "base64url",
    );
    const bad = await app.request("/v1/receipts/verify", json({ receipt: `${h}.${forged}.${s}` }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "RECEIPT_INVALID" } });
  });
});
