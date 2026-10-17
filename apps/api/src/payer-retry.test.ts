// The payer never pays twice for one request (section K; D54, D66): createPaymentFetch against
// the real paywall, relay and API, with a mock RPC.
import {
  associatedTokenAccount,
  DEVNET,
  decodeHeader,
  encodeHeader,
  M2mError,
  NETWORKS,
  type PaymentPayload,
  signReceipt,
  verifyReceiptSignature,
} from "@m2m-monster/core";
import { type MockRpcState, putTokenAccount, signatureOf } from "@m2m-monster/core/testing";
import {
  createApiClient,
  createPaymentFetch,
  createPaywall,
  paymentOutcome,
  settlementOf,
} from "@m2m-monster/sdk";
import type { Address, KeyPairSigner } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDeps } from "./app.js";
import { signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;
const URL_ = "https://agent.example/forecast";
const PRICE = { mint: USDC, amount: "100000" };

let deps: AppDeps;
let state: MockRpcState;
let payer: KeyPairSigner;
let handled: number;
let resource: (request: Request) => Promise<Response>;
/** PAYMENT-SIGNATURE headers the payer sent, in order. */
let headers: string[];

beforeEach(async () => {
  let app: Awaited<ReturnType<typeof testApp>>["app"];
  ({ app, deps, state } = await testApp({ now: Date.now }));
  state.autoConfirm = true;
  payer = await signer(1);
  const payee = await signer(2);
  for (const [owner, amount] of [
    [payer.address, 10_000_000n],
    [payee.address, 0n],
    [TREASURY, 0n],
  ] as const) {
    putTokenAccount(state, await associatedTokenAccount(owner, USDC), owner, USDC, amount);
  }
  const api = createApiClient("http://api.test", { fetch: (r) => app.fetch(r) });
  const paywall = createPaywall({ api, rpc: deps.rpc, network: DEVNET, payee: payee.address });
  handled = 0;
  headers = [];
  resource = (request) =>
    paywall.handle(request, PRICE, {}, async () => {
      handled++;
      return Response.json({ forecast: "sunny" });
    });
});

/** A payer whose transport runs `script` for each paid attempt (1-based). */
const payerWith = (
  script: (attempt: number, request: Request) => Promise<Response>,
): ReturnType<typeof createPaymentFetch> => {
  let attempt = 0;
  return createPaymentFetch({
    rpc: deps.rpc,
    signer: payer,
    serviceAddress: deps.serviceAddress,
    fetch: (request) => {
      const header = request.headers.get("PAYMENT-SIGNATURE");
      if (!header) return resource(request);
      headers.push(header);
      return script(++attempt, request);
    },
  });
};

const lost = () => Promise.reject(new TypeError("network error: response lost"));
const settledButLost = async (request: Request) => {
  await resource(request);
  return lost();
};
const quoteExpired = (transaction = "", receipt?: string) =>
  new Response(JSON.stringify({ error: { code: "QUOTE_EXPIRED" } }), {
    status: 402,
    headers: {
      "PAYMENT-RESPONSE": encodeHeader({
        success: false,
        errorReason: "QUOTE_EXPIRED",
        transaction,
        network: DEVNET,
        ...(receipt && { extensions: { "m2m-receipt": { info: { receipt } } } }),
      }),
    },
  });
const statusCode = (error: unknown) => (error instanceof M2mError ? error.code : error);

describe("createPaymentFetch never pays twice (D66)", () => {
  it("pays, loses the response, retries: one payment, the receipt as proof", async () => {
    const pay = payerWith((attempt, request) =>
      attempt === 1 ? settledButLost(request) : resource(request),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    expect(state.sent).toHaveLength(1);

    const again = await pay(URL_);
    expect(again.status).toBe(402);
    expect(headers).toHaveLength(2);
    expect(headers[1]).toBe(headers[0]); // the same signed payment, no new quote
    expect(state.sent).toHaveLength(1);
    expect(handled).toBe(1);
    const outcome = paymentOutcome(again);
    expect(outcome).toMatchObject({
      status: "already_paid",
      transaction: signatureOf(state.sent[0] as string),
    });
    expect(outcome?.receiptData?.transaction).toBe(outcome?.transaction);
    expect(outcome?.receipt).toBe(settlementOf(again)?.extensions?.["m2m-receipt"]?.info.receipt);

    // The payment is resolved: a later request is a new purchase.
    const next = await pay(URL_);
    expect(next.status).toBe(200);
    expect(paymentOutcome(next)?.status).toBe("paid");
    expect(state.sent).toHaveLength(2);
  });

  it("a normal payment reports paid", async () => {
    const res = await payerWith((_, request) => resource(request))(URL_);
    expect(res.status).toBe(200);
    expect(paymentOutcome(res)).toMatchObject({ status: "paid" });
    expect(paymentOutcome(res)?.receipt).toBeTypeOf("string");
  });

  it("QUOTE_EXPIRED without a receipt, transaction confirmed on-chain: already paid", async () => {
    const pay = payerWith(async (attempt, request) =>
      attempt === 1 ? settledButLost(request) : quoteExpired(),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    const again = await pay(URL_);
    expect(paymentOutcome(again)).toMatchObject({ status: "already_paid" });
    expect(paymentOutcome(again)?.receipt).toBeUndefined();
    expect(state.sent).toHaveLength(1);
  });

  it("QUOTE_EXPIRED without a receipt, never landed, blockhash expired: not paid, then pays", async () => {
    const pay = payerWith(async (attempt, request) =>
      attempt === 1 ? lost() : attempt === 2 ? quoteExpired() : resource(request),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    state.blockHeight = 2_000n; // past lastValidBlockHeight (1000)
    const again = await pay(URL_);
    expect(again.status).toBe(402);
    expect(paymentOutcome(again)).toMatchObject({ status: "not_paid" });
    expect(state.sent).toHaveLength(0);

    state.blockHeight = 10n;
    const paid = await pay(URL_);
    expect(paid.status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(headers[2]).not.toBe(headers[0]); // a new payment only after the proof
  });

  it("never landed but the blockhash is still valid: PAYMENT_STATUS_UNKNOWN, keeps the payment", async () => {
    const pay = payerWith(async (attempt, request) =>
      attempt === 1 ? lost() : attempt === 2 ? quoteExpired() : resource(request),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(state.sent).toHaveLength(0);

    // Still pending: the next attempt resends the same payment, which now settles once.
    const res = await pay(URL_);
    expect(res.status).toBe(200);
    expect(headers).toHaveLength(3);
    expect(new Set(headers).size).toBe(1);
    expect(state.sent).toHaveLength(1);
  });

  it("RPC down: PAYMENT_STATUS_UNKNOWN, no new quote and no new payment", async () => {
    const pay = payerWith(async (attempt) => (attempt === 1 ? lost() : quoteExpired()));
    await expect(pay(URL_)).rejects.toThrow("response lost");
    state.failing = new Set(["getSignatureStatuses", "getBlockHeight", "getTransaction"]);
    state.blockHeight = 2_000n;
    for (let i = 0; i < 2; i++) {
      expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    }
    expect(new Set(headers).size).toBe(1);
    expect(state.sent).toHaveLength(0);
  });

  it("a receipt that does not verify is not proof: decided on-chain", async () => {
    const pay = payerWith(async (attempt) =>
      attempt === 1 ? lost() : quoteExpired("5".repeat(87), "aaa.bbb.ccc"),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    state.blockHeight = 2_000n;
    expect(paymentOutcome(await pay(URL_))).toMatchObject({ status: "not_paid" });
  });

  it("an explicit Idempotency-Key binds the payment to that key", async () => {
    const pay = payerWith((attempt, request) =>
      attempt === 1 ? settledButLost(request) : resource(request),
    );
    const init = { headers: { "Idempotency-Key": "order-42" } };
    await expect(pay(URL_, init)).rejects.toThrow("response lost");
    const again = await pay(`${URL_}?retry=1`, init);
    expect(paymentOutcome(again)?.status).toBe("already_paid");
    expect(state.sent).toHaveLength(1);
  });
});

/** The transaction signature inside a PAYMENT-SIGNATURE header. */
const signatureInHeader = (header: string) =>
  signatureOf(
    (decodeHeader<PaymentPayload>(header).payload as { transaction: string }).transaction,
  );

describe("adversarial review of the retry code (D67)", () => {
  it("a genuine receipt of another payment (other transaction, other quote) is not proof", async () => {
    // A real receipt from an earlier, unrelated purchase.
    const earlier = await payerWith((_, request) => resource(request))(`${URL_}?earlier=1`);
    const otherReceipt = paymentOutcome(earlier)?.receipt as string;
    const otherTx = paymentOutcome(earlier)?.transaction as string;
    expect(otherReceipt).toBeTypeOf("string");

    const pay = payerWith(async (attempt) =>
      attempt === 1 ? lost() : quoteExpired(otherTx, otherReceipt),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    state.blockHeight = 2_000n;
    expect(paymentOutcome(await pay(URL_))).toMatchObject({ status: "not_paid" });
    expect(state.sent).toHaveLength(1); // only the earlier purchase
  });

  it("a service-signed receipt naming this transaction but another quote is not accepted as proof", async () => {
    const earlier = await payerWith((_, request) => resource(request))(`${URL_}?earlier=1`);
    const genuine = await verifyReceiptSignature(
      paymentOutcome(earlier)?.receipt as string,
      deps.serviceAddress,
    );
    const pay = payerWith(async (attempt, request) => {
      if (attempt === 1) return settledButLost(request);
      const forged = await signReceipt(
        { ...genuine, id: "q_another_quote", transaction: signatureInHeader(headers[0] as string) },
        deps.serviceKeys.privateKey,
        deps.serviceAddress,
      );
      return quoteExpired(signatureInHeader(headers[0] as string), forged);
    });
    await expect(pay(URL_)).rejects.toThrow("response lost");
    const res = await pay(URL_);
    // Decided on-chain (the transaction is confirmed), without trusting the receipt.
    expect(paymentOutcome(res)).toMatchObject({ status: "already_paid" });
    expect(paymentOutcome(res)?.receiptData).toBeUndefined();
    expect(state.sent).toHaveLength(2);
  });

  it("malicious seller: settles and then asks to pay again with a fresh 402 → no second payment", async () => {
    const pay = payerWith(async (_, request) => {
      await resource(request); // takes the money
      return resource(new Request(URL_)); // and answers with a new PAYMENT-REQUIRED
    });
    const res = await pay(URL_);
    expect(res.status).toBe(402);
    expect(paymentOutcome(res)).toMatchObject({ status: "already_paid" });
    expect(new Set(headers).size).toBe(1);
    expect(state.sent).toHaveLength(1);
  });

  it("malicious seller: claims success for another transaction → not 'paid', never pays twice", async () => {
    const fakeSuccess = () =>
      new Response("{}", {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": encodeHeader({
            success: true,
            transaction: "1".repeat(64),
            network: DEVNET,
          }),
        },
      });
    const pay = payerWith(async () => fakeSuccess());
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    state.blockHeight = 2_000n;
    expect(paymentOutcome(await pay(URL_))).toMatchObject({ status: "not_paid" });
    expect(new Set(headers).size).toBe(1);
    expect(state.sent).toHaveLength(0);
  });

  it("malicious seller: rejects every payment (denial) → the agent loses nothing and never pays twice", async () => {
    const pay = payerWith(async () => quoteExpired());
    for (let round = 0; round < 3; round++) {
      state.blockHeight = 10n;
      expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
      state.blockHeight = 2_000n;
      expect(paymentOutcome(await pay(URL_))).toMatchObject({ status: "not_paid" });
    }
    // One signed payment per round, each new one only after proof the previous cannot land.
    expect(new Set(headers).size).toBe(3);
    expect(state.sent).toHaveLength(0);
  });

  it("processed but not confirmed: unknown, even with the blockhash expired", async () => {
    const pay = payerWith(async (attempt) => (attempt === 1 ? lost() : quoteExpired()));
    await expect(pay(URL_)).rejects.toThrow("response lost");
    state.statuses.set(signatureInHeader(headers[0] as string), {
      err: null,
      confirmationStatus: "processed",
    });
    state.blockHeight = 2_000n;
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(new Set(headers).size).toBe(1);
  });

  it("incoherent RPC: a lagging node's 'not found' after expiry is not proof", async () => {
    const pay = payerWith(async (attempt) => (attempt === 1 ? lost() : quoteExpired()));
    await expect(pay(URL_)).rejects.toThrow("response lost");
    state.blockHeight = 2_000n;
    state.finalizedSlot = 900n;
    state.statusSlot = 899n;
    expect(statusCode(await pay(URL_).catch((e) => e))).toBe("PAYMENT_STATUS_UNKNOWN");
    state.statusSlot = 900n;
    expect(paymentOutcome(await pay(URL_))).toMatchObject({ status: "not_paid" });
  });

  it("two concurrent calls for the same request share one payment", async () => {
    const pay = payerWith((_, request) => resource(request));
    const [a, b] = await Promise.all([pay(URL_), pay(URL_)]);
    expect(headers).toHaveLength(1);
    expect(state.sent).toHaveLength(1);
    expect(handled).toBe(1);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(paymentOutcome(a)?.status).toBe("paid");
    expect(paymentOutcome(b)?.transaction).toBe(paymentOutcome(a)?.transaction);
    expect(await a.json()).toEqual(await b.json());
  });

  it("two concurrent retries of a pending payment resend it once and resolve once", async () => {
    const pay = payerWith((attempt, request) =>
      attempt === 1 ? settledButLost(request) : resource(request),
    );
    await expect(pay(URL_)).rejects.toThrow("response lost");
    const [a, b] = await Promise.all([pay(URL_), pay(URL_)]);
    expect(headers).toHaveLength(2);
    expect(paymentOutcome(a)?.status).toBe("already_paid");
    expect(paymentOutcome(b)?.status).toBe("already_paid");
    expect(state.sent).toHaveLength(1);
  });
});
