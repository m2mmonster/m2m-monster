// x402 v2 over HTTP with the m2m-split scheme (section G; decisions D15, D21, D34).
// Payee: `createPaywall` answers 402 and settles. Payer: `createPaymentFetch` pays and retries.
import {
  decodeHeader,
  encodeHeader,
  HEADERS,
  M2M_SPLIT,
  M2mError,
  type Network,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  paymentIdOf,
  paymentRequired,
  quoteFromRequirements,
  type ResourceInfo,
  type SettlementResponse,
  type SolanaRpc,
  splitExpectation,
  verifyQuote,
  verifySplitTransaction,
  X402_VERSION,
} from "@m2m-monster/core";
import type { KeyPairSigner } from "@solana/kit";
import type { ApiClient, Settlement } from "./api.js";
import { submitPayment, verifyPayment } from "./payee.js";
import { payQuote } from "./payer.js";

export interface Price {
  /** Whitelisted mint (USDC or USDT on mainnet; USDC on Devnet). */
  mint: string;
  /** Gross amount in base units of the mint. */
  amount: string | bigint;
}

export interface PaywallOptions {
  /** API client; give it the payee's apiKey so its referral discounts apply. */
  api: ApiClient;
  rpc: SolanaRpc;
  network: Network;
  /** The payee wallet that receives payments. */
  payee: string;
  /**
   * `relay` (default): the m2m relay broadcasts the payer-signed transaction.
   * `self`: this process simulates and broadcasts it, then reports the signature for a receipt.
   */
  submit?: "relay" | "self";
  now?: () => number;
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Payee side: protect a handler behind an m2m-split payment. */
export function createPaywall(options: PaywallOptions) {
  const now = options.now ?? Date.now;

  async function required(request: Request, price: Price, resource: Omit<ResourceInfo, "url">) {
    const quote = await options.api.requestQuote(
      {
        network: options.network,
        mint: price.mint,
        amount: `${price.amount}`,
        payee: options.payee,
      },
      `402-${crypto.randomUUID()}`,
    );
    const body = paymentRequired(quote, { url: request.url, ...resource });
    return json(body, 402, { [HEADERS.paymentRequired]: encodeHeader(body) });
  }

  async function settle(
    payload: PaymentPayload,
    price: Price,
  ): Promise<{ settlement: Settlement; payer: string }> {
    if (payload.x402Version !== X402_VERSION) {
      throw new M2mError("INVALID_REQUEST", `Only x402 version ${X402_VERSION} is supported.`);
    }
    const quote = quoteFromRequirements(payload.accepted);
    if (
      quote.payee !== options.payee ||
      quote.network !== options.network ||
      quote.mint !== price.mint ||
      quote.amount !== `${price.amount}`
    ) {
      throw new M2mError(
        "PAYMENT_TRANSACTION_INVALID",
        "The quote is not for this resource's price.",
      );
    }
    const transaction = payload.payload.transaction;
    if (typeof transaction !== "string") {
      throw new M2mError("INVALID_REQUEST", "payload.transaction is required.");
    }
    const paymentId = paymentIdOf(payload);
    if (!paymentId) {
      throw new M2mError("INVALID_REQUEST", "The payment-identifier extension id is required.");
    }
    const serviceAddress = await options.api.serviceAddress();

    if (options.submit === "self") {
      const verified = await verifyPayment({
        rpc: options.rpc,
        quote,
        transaction,
        serviceAddress,
        now,
      });
      const signature = await submitPayment({ rpc: options.rpc, transaction });
      return {
        settlement: await options.api.reportPayment(quote, signature),
        payer: verified.payer,
      };
    }

    // The relay simulates, enforces expiry and single use, and answers retries idempotently.
    if (!(await verifyQuote(quote, serviceAddress))) throw new M2mError("QUOTE_INVALID");
    const verified = await verifySplitTransaction(transaction, splitExpectation(quote), {
      signed: true,
    });
    return {
      settlement: await options.api.relayPayment(quote, transaction, paymentId),
      payer: verified.payer,
    };
  }

  return {
    /**
     * Answers 402 with an m2m-split quote, or verifies and settles the payment in the
     * `PAYMENT-SIGNATURE` header and then runs `handler` (payment flow `upfront`).
     */
    async handle(
      request: Request,
      price: Price,
      resource: Omit<ResourceInfo, "url">,
      handler: () => Promise<Response>,
    ): Promise<Response> {
      const header = request.headers.get(HEADERS.paymentSignature);
      if (!header) return required(request, price, resource);

      let result: { settlement: Settlement; payer: string };
      try {
        result = await settle(decodeHeader<PaymentPayload>(header), price);
      } catch (error) {
        const e = error instanceof M2mError ? error : new M2mError("INTERNAL_ERROR");
        const failure: SettlementResponse = {
          success: false,
          errorReason: e.code,
          transaction: "",
          network: options.network,
        };
        return json({ error: { code: e.code, message: e.message } }, 402, {
          [HEADERS.paymentResponse]: encodeHeader(failure),
        });
      }

      const { settlement, payer } = result;
      const response = await handler();
      const success: SettlementResponse = {
        success: true,
        transaction: settlement.signature,
        network: options.network,
        payer,
        amount: settlement.receipt_data.amount,
        extensions: {
          "m2m-receipt": { info: { receipt: settlement.receipt } },
          "m2m-referral": { info: { link: settlement.receipt_data.referral } },
        },
      };
      const headers = new Headers(response.headers);
      headers.set(HEADERS.paymentResponse, encodeHeader(success));
      return new Response(response.body, { status: response.status, headers });
    },
  };
}

export interface PayerOptions {
  rpc: SolanaRpc;
  /** The payer's own key pair. It never leaves this process. */
  signer: KeyPairSigner;
  /** Address of the m2m.monster service key, e.g. from `api.serviceAddress()`. */
  serviceAddress: string;
  /** Only pay on this network (CAIP-2). */
  network?: Network;
  maxComputeUnitPrice?: bigint;
}

async function m2mPayload(
  options: PayerOptions,
  accepted: PaymentRequirements,
  required: Pick<PaymentRequired, "resource" | "extensions">,
): Promise<PaymentPayload> {
  const quote = quoteFromRequirements(accepted);
  // payQuote checks the quote signature, expiry, treasury and whitelist before paying.
  const { transaction } = await payQuote({
    rpc: options.rpc,
    signer: options.signer,
    quote,
    serviceAddress: options.serviceAddress,
    ...(options.maxComputeUnitPrice !== undefined && {
      maxComputeUnitPrice: options.maxComputeUnitPrice,
    }),
  });
  return {
    x402Version: X402_VERSION,
    resource: required.resource,
    accepted,
    payload: { transaction },
    extensions: {
      ...required.extensions,
      "payment-identifier": {
        ...required.extensions?.["payment-identifier"],
        info: { required: true, id: `pay_${crypto.randomUUID().replaceAll("-", "")}` },
      },
    },
  };
}

/**
 * Payer side: a `fetch` that answers an m2m-split 402 by paying (build, simulate and sign
 * locally) and retrying with the `PAYMENT-SIGNATURE` header.
 */
export function createPaymentFetch(
  options: PayerOptions & { fetch?: (request: Request) => Promise<Response> },
) {
  const send = options.fetch ?? ((request: Request) => fetch(request));
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const first = await send(request.clone());
    const header = first.headers.get(HEADERS.paymentRequired);
    if (first.status !== 402 || !header) return first;

    const required = decodeHeader<PaymentRequired>(header);
    const accepted = required.accepts.find(
      (a) => a.scheme === M2M_SPLIT && (!options.network || a.network === options.network),
    );
    if (!accepted) return first;

    const payload = await m2mPayload(options, accepted, required);
    const retry = new Request(request);
    retry.headers.set(HEADERS.paymentSignature, encodeHeader(payload));
    return send(retry);
  };
}

/** Reads the settlement and the m2m receipt from a paid response. */
export function settlementOf(response: Response): SettlementResponse | undefined {
  const header = response.headers.get(HEADERS.paymentResponse);
  return header ? decodeHeader<SettlementResponse>(header) : undefined;
}

/**
 * Same shape as `SchemeNetworkClient` in the official `@x402/core` client, for agents that
 * already use it: `x402Client.register("solana:...", m2mSplitSchemeClient(options))`.
 */
export function m2mSplitSchemeClient(options: PayerOptions) {
  return {
    scheme: M2M_SPLIT,
    async createPaymentPayload(
      x402Version: number,
      requirements: PaymentRequirements,
      context?: { extensions?: Record<string, unknown>; maxAmountPerPayment?: string },
    ) {
      if (
        context?.maxAmountPerPayment !== undefined &&
        BigInt(requirements.amount) > BigInt(context.maxAmountPerPayment)
      ) {
        throw new M2mError(
          "INVALID_REQUEST",
          "The amount is above the client's maxAmountPerPayment.",
        );
      }
      const payload = await m2mPayload(options, requirements, {
        resource: { url: "" },
        extensions: (context?.extensions ?? {}) as PaymentRequired["extensions"],
      });
      return { x402Version, payload: payload.payload, extensions: payload.extensions };
    },
  };
}
