// x402 v2 end to end with the SDK: payee paywall and payer fetch, against the API and a mock RPC.
import {
  associatedTokenAccount,
  DEVNET,
  decodeHeader,
  encodeHeader,
  NETWORKS,
  type PaymentPayload,
  type PaymentRequired,
  verifyReceiptSignature,
} from "@m2m-monster/core";
import { type MockRpcState, putTokenAccount } from "@m2m-monster/core/testing";
import {
  createApiClient,
  createPaymentFetch,
  createPaywall,
  m2mSplitSchemeClient,
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
let payee: KeyPairSigner;
let api: ReturnType<typeof createApiClient>;
let handled: number;
let resource: (request: Request) => Promise<Response>;

beforeEach(async () => {
  let app: Awaited<ReturnType<typeof testApp>>["app"];
  ({ app, deps, state } = await testApp({ now: Date.now }));
  state.autoConfirm = true;
  payer = await signer(1);
  payee = await signer(2);
  putTokenAccount(
    state,
    await associatedTokenAccount(payer.address, USDC),
    payer.address,
    USDC,
    10_000_000n,
  );
  putTokenAccount(
    state,
    await associatedTokenAccount(payee.address, USDC),
    payee.address,
    USDC,
    0n,
  );
  putTokenAccount(state, await associatedTokenAccount(TREASURY, USDC), TREASURY, USDC, 0n);
  api = createApiClient("http://api.test", { fetch: (r) => app.fetch(r) });

  handled = 0;
  const paywall = createPaywall({ api, rpc: deps.rpc, network: DEVNET, payee: payee.address });
  resource = (request) =>
    paywall.handle(
      request,
      PRICE,
      { description: "Weather forecast", mimeType: "application/json" },
      async () => {
        handled++;
        return Response.json({ forecast: "sunny" });
      },
    );
});

const payerFetch = () =>
  createPaymentFetch({
    rpc: deps.rpc,
    signer: payer,
    serviceAddress: deps.serviceAddress,
    fetch: resource,
  });

describe("x402 v2 with m2m-split (section G, D21)", () => {
  it("answers 402 with PAYMENT-REQUIRED offering m2m-split", async () => {
    const res = await resource(new Request(URL_));
    expect(res.status).toBe(402);
    const required = decodeHeader<PaymentRequired>(res.headers.get("PAYMENT-REQUIRED") ?? "");
    expect(required).toMatchObject({
      x402Version: 2,
      resource: { url: URL_, description: "Weather forecast" },
      accepts: [
        {
          scheme: "m2m-split",
          network: DEVNET,
          amount: "100000",
          asset: USDC,
          payTo: payee.address,
          maxTimeoutSeconds: 30,
          extra: {
            fee_gross: "1000",
            discount: "0",
            fee_net: "1000",
            payee_amount: "99000",
            treasury: TREASURY,
            paymentFlow: "upfront",
          },
        },
      ],
      extensions: { "payment-identifier": { info: { required: true } } },
    });
    expect(required.extensions?.["m2m-referral"]?.info.link).toContain(`ref=${payee.address}`);
    expect(await res.json()).toEqual(required);
    expect(handled).toBe(0);
  });

  it("pays, settles once and serves the resource with PAYMENT-RESPONSE and a receipt", async () => {
    const res = await payerFetch()(URL_);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forecast: "sunny" });
    expect(handled).toBe(1);
    expect(state.sent).toHaveLength(1);

    const settlement = settlementOf(res);
    expect(settlement).toMatchObject({
      success: true,
      network: DEVNET,
      payer: payer.address,
      amount: "100000",
    });
    const receipt = await verifyReceiptSignature(
      settlement?.extensions?.["m2m-receipt"]?.info.receipt as string,
      deps.serviceAddress,
    );
    expect(receipt).toMatchObject({
      transaction: settlement?.transaction,
      fee_net: "1000",
      payee_amount: "99000",
    });
  });

  it("a replayed PAYMENT-SIGNATURE never unlocks the resource again (section K)", async () => {
    let header = "";
    const capture = createPaymentFetch({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
      fetch: async (request) => {
        header = request.headers.get("PAYMENT-SIGNATURE") ?? header;
        return resource(request);
      },
    });
    const first = await capture(URL_);
    expect(first.status).toBe(200);
    const replay = await resource(new Request(URL_, { headers: { "PAYMENT-SIGNATURE": header } }));
    expect(replay.status).toBe(402);
    const failure = settlementOf(replay);
    expect(failure).toMatchObject({
      success: false,
      errorReason: "QUOTE_EXPIRED",
      transaction: settlementOf(first)?.transaction,
    });
    // The payer still gets its receipt as proof of the original payment.
    expect(failure?.extensions?.["m2m-receipt"]?.info.receipt).toBe(
      settlementOf(first)?.extensions?.["m2m-receipt"]?.info.receipt,
    );
    expect(handled).toBe(1);
    expect(state.sent).toHaveLength(1);

    // The recognition documented in llms.txt and the SDK README ("Retries: never pay twice").
    const res = replay;
    const s = settlementOf(res);
    const receipt = s?.extensions?.["m2m-receipt"]?.info.receipt as string | undefined;
    let alreadyPaid = false;
    if (res.status === 402 && s?.errorReason === "QUOTE_EXPIRED" && s.transaction && receipt) {
      const { receipt_data } = await api.verifyReceipt(receipt);
      expect(receipt_data.amount).toBe("100000");
      alreadyPaid = true;
    }
    expect(alreadyPaid).toBe(true);
  });

  it("a replayed payment is refused in submit: self mode too", async () => {
    const paywall = createPaywall({
      api,
      rpc: deps.rpc,
      network: DEVNET,
      payee: payee.address,
      submit: "self",
    });
    let served = 0;
    let header = "";
    const handle = (request: Request) =>
      paywall.handle(request, PRICE, {}, async () => {
        served++;
        return Response.json({ ok: true });
      });
    const pay = createPaymentFetch({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
      fetch: async (request) => {
        header = request.headers.get("PAYMENT-SIGNATURE") ?? header;
        return handle(request);
      },
    });
    expect((await pay(URL_)).status).toBe(200);
    const replay = await handle(new Request(URL_, { headers: { "PAYMENT-SIGNATURE": header } }));
    expect(replay.status).toBe(402);
    expect(settlementOf(replay)).toMatchObject({ success: false, errorReason: "QUOTE_EXPIRED" });
    expect(served).toBe(1);
    expect(state.sent).toHaveLength(1);
  });

  it("rejects a quote for another price", async () => {
    const quoted = await resource(new Request(URL_));
    const required = decodeHeader<PaymentRequired>(quoted.headers.get("PAYMENT-REQUIRED") ?? "");
    const scheme = m2mSplitSchemeClient({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
    });
    const paid = await scheme.createPaymentPayload(2, required.accepts[0] as never, {
      extensions: required.extensions as never,
    });
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: required.accepts[0] as never,
      ...paid,
    };
    const cheaper = createPaywall({ api, rpc: deps.rpc, network: DEVNET, payee: payee.address });
    const res = await cheaper.handle(
      new Request(URL_, { headers: { "PAYMENT-SIGNATURE": encodeHeader(payload) } }),
      { mint: USDC, amount: "200000" },
      {},
      async () => Response.json({}),
    );
    expect(res.status).toBe(402);
    expect(settlementOf(res)).toMatchObject({
      success: false,
      errorReason: "PAYMENT_TRANSACTION_INVALID",
    });
    expect(state.sent).toHaveLength(0);
  });

  it("requires the payment identifier (section K)", async () => {
    const quoted = await resource(new Request(URL_));
    const required = decodeHeader<PaymentRequired>(quoted.headers.get("PAYMENT-REQUIRED") ?? "");
    const scheme = m2mSplitSchemeClient({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
    });
    const paid = await scheme.createPaymentPayload(2, required.accepts[0] as never);
    const res = await resource(
      new Request(URL_, {
        headers: {
          "PAYMENT-SIGNATURE": encodeHeader({
            x402Version: 2,
            accepted: required.accepts[0],
            payload: paid.payload,
          }),
        },
      }),
    );
    expect(res.status).toBe(402);
    expect(settlementOf(res)).toMatchObject({ success: false, errorReason: "INVALID_REQUEST" });
  });

  it("settles with submit: self and reports the signature for a receipt (D8)", async () => {
    const paywall = createPaywall({
      api,
      rpc: deps.rpc,
      network: DEVNET,
      payee: payee.address,
      submit: "self",
    });
    const fetchSelf = createPaymentFetch({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
      fetch: (request) =>
        paywall.handle(request, PRICE, {}, async () => Response.json({ ok: true })),
    });
    const res = await fetchSelf(URL_);
    expect(res.status).toBe(200);
    expect(settlementOf(res)?.extensions?.["m2m-receipt"]?.info.receipt).toEqual(
      expect.any(String),
    );
  });

  it("honours the official client's maxAmountPerPayment", async () => {
    const quoted = await resource(new Request(URL_));
    const required = decodeHeader<PaymentRequired>(quoted.headers.get("PAYMENT-REQUIRED") ?? "");
    const scheme = m2mSplitSchemeClient({
      rpc: deps.rpc,
      signer: payer,
      serviceAddress: deps.serviceAddress,
    });
    await expect(
      scheme.createPaymentPayload(2, required.accepts[0] as never, {
        maxAmountPerPayment: "99999",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
