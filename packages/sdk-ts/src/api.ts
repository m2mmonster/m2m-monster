// HTTP client for the m2m.monster API, typed from spec/openapi.json (pnpm generate:client).
import { type ErrorCode, M2mError, registrationMessage, type SignedQuote } from "@m2m-monster/core";
import { getBase58Decoder, getUtf8Encoder, type KeyPairSigner, signBytes } from "@solana/kit";
import createClient from "openapi-fetch";
import type { components, paths } from "./api-types.js";

export type QuoteRequest = components["schemas"]["QuoteRequest"];
export type Settlement = components["schemas"]["Settlement"];
export type ReceiptData = components["schemas"]["ReceiptData"];
type Ok<P extends keyof paths, M extends "get" | "post", S extends number> = paths[P][M] extends {
  responses: { [K in S]: { content: { "application/json": infer T } } };
}
  ? T
  : never;

export type ReferralStatus = Ok<"/v1/agents/me/referrals", "get", 200>;
export type ReceiptHistory = Ok<"/v1/agents/me/receipts", "get", 200>;
export type UnsignedTransaction = components["schemas"]["UnsignedTransaction"];
export type PaymentCheck = Ok<"/v1/payments/verify", "post", 200>;
export type ServiceStatus = Ok<"/status.json", "get", 200>;
export type Registration = Ok<"/v1/agents/register", "post", 201>;
export type Challenge = Ok<"/v1/agents/challenge", "post", 201> & { message: string };

export function createApiClient(
  baseUrl: string,
  options: {
    /** From optional registration; unlocks referral discounts and receipt history. */
    apiKey?: string;
    fetch?: (request: Request) => Promise<Response>;
  } = {},
) {
  const client = createClient<paths>({
    baseUrl,
    ...(options.fetch && { fetch: options.fetch }),
    ...(options.apiKey && { headers: { Authorization: `Bearer ${options.apiKey}` } }),
  });
  let serviceAddress: Promise<string> | undefined;

  const fail = (error: unknown): never => {
    const body = error as { error?: { code?: string; message?: string } } | undefined;
    throw new M2mError(
      (body?.error?.code ?? "INTERNAL_ERROR") as ErrorCode,
      body?.error?.message ?? "Unexpected API response",
    );
  };

  return {
    /** Requests a signed 30-second quote. Reuse the same key when retrying (section K). */
    async requestQuote(request: QuoteRequest, idempotencyKey: string): Promise<SignedQuote> {
      const { data, error } = await client.POST("/v1/quotes", {
        params: { header: { "idempotency-key": idempotencyKey } },
        body: request,
      });
      if (!data) return fail(error);
      return data as SignedQuote;
    },

    /**
     * Relay: verifies and broadcasts a transaction the payer already signed and returns the
     * signed receipt. The relay never signs or pays. Reuse the same key when retrying.
     */
    async relayPayment(
      quote: SignedQuote,
      transaction: string,
      idempotencyKey: string,
    ): Promise<Settlement> {
      const { data, error } = await client.POST("/v1/payments", {
        params: { header: { "idempotency-key": idempotencyKey } },
        body: { quote: quote as never, transaction },
      });
      return data ?? fail(error);
    },

    /** Receipt for a payment the payee broadcast itself, once confirmed on-chain. */
    async reportPayment(quote: SignedQuote, signature: string): Promise<Settlement> {
      const { data, error } = await client.POST("/v1/receipts", {
        body: { quote: quote as never, signature },
      });
      return data ?? fail(error);
    },

    async getReceipt(id: string): Promise<Settlement> {
      const { data, error } = await client.GET("/v1/receipts/{id}", { params: { path: { id } } });
      return data ?? fail(error);
    },

    /** Verifies a receipt's signature and its transaction on-chain. */
    async verifyReceipt(
      receipt: string,
    ): Promise<{ valid: true; receipt_data: ReceiptData; slot: string }> {
      const { data, error } = await client.POST("/v1/receipts/verify", { body: { receipt } });
      return data ?? fail(error);
    },

    /**
     * Optional registration (section D): signs the challenge locally with the agent's key and
     * returns the api_key. The private key never leaves this process.
     */
    async register(input: {
      signer: KeyPairSigner;
      agentId: string;
      capabilities?: string[];
      referredBy?: string;
    }): Promise<Registration> {
      const challenge = await client.POST("/v1/agents/challenge", {
        body: { solana_pubkey: input.signer.address },
      });
      if (!challenge.data) return fail(challenge.error);
      const message = registrationMessage(input.signer.address, challenge.data.nonce);
      const signature = await signBytes(
        input.signer.keyPair.privateKey,
        getUtf8Encoder().encode(message),
      );
      const { data, error } = await client.POST("/v1/agents/register", {
        body: {
          agent_id: input.agentId,
          solana_pubkey: input.signer.address,
          capabilities: input.capabilities ?? [],
          ...(input.referredBy && { referred_by: input.referredBy }),
          signature: getBase58Decoder().decode(signature),
        },
      });
      return data ?? fail(error);
    },

    /** Referrer, referred agents, credits and expiry dates. Requires an apiKey. */
    async referralStatus(): Promise<ReferralStatus> {
      const { data, error } = await client.GET("/v1/agents/me/referrals");
      return data ?? fail(error);
    },

    /** Receipt history as payer or payee, newest first. Requires an apiKey. */
    async receiptHistory(query: { limit?: number; before?: number } = {}): Promise<ReceiptHistory> {
      const { data, error } = await client.GET("/v1/agents/me/receipts", {
        params: {
          query: { limit: query.limit ?? 50, ...(query.before && { before: query.before }) },
        },
      });
      return data ?? fail(error);
    },

    /** Unsigned m2m-split for `payer` to sign locally (accounts, USDC fee balance, simulation). */
    async buildPayment(
      quote: SignedQuote,
      payer: string,
      maxComputeUnitPrice?: bigint,
    ): Promise<UnsignedTransaction> {
      const { data, error } = await client.POST("/v1/payments/build", {
        body: {
          quote: quote as never,
          payer,
          ...(maxComputeUnitPrice !== undefined && {
            max_compute_unit_price: `${maxComputeUnitPrice}`,
          }),
        },
      });
      return data ?? fail(error);
    },

    /** For the payee: checks a payer-signed transaction against its quote and simulates it. */
    async verifyPayment(quote: SignedQuote, transaction: string): Promise<PaymentCheck> {
      const { data, error } = await client.POST("/v1/payments/verify", {
        body: { quote: quote as never, transaction },
      });
      return data ?? fail(error);
    },

    /** Unsigned refund from the payee back to the payer, for the payee to sign. */
    async buildRefund(receipt: string, amount: string | bigint): Promise<UnsignedTransaction> {
      const { data, error } = await client.POST("/v1/refunds/build", {
        body: { receipt, amount: `${amount}` },
      });
      return data ?? fail(error);
    },

    async pricing(): Promise<Record<string, unknown>> {
      const { data, error } = await client.GET("/pricing.json");
      return data ?? fail(error);
    },

    async status(): Promise<ServiceStatus> {
      const { data, error } = await client.GET("/status.json");
      return data ?? fail(error);
    },

    /** Starts registration: the agent signs the returned message with its own key. */
    async registrationChallenge(pubkey: string): Promise<Challenge> {
      const { data, error } = await client.POST("/v1/agents/challenge", {
        body: { solana_pubkey: pubkey },
      });
      if (!data) return fail(error);
      return { ...data, message: registrationMessage(pubkey, data.nonce) };
    },

    /** Completes registration with a signature made elsewhere (e.g. through the MCP server). */
    async registerSigned(input: {
      agentId: string;
      pubkey: string;
      signature: string;
      capabilities?: string[];
      referredBy?: string;
    }): Promise<Registration> {
      const { data, error } = await client.POST("/v1/agents/register", {
        body: {
          agent_id: input.agentId,
          solana_pubkey: input.pubkey,
          capabilities: input.capabilities ?? [],
          ...(input.referredBy && { referred_by: input.referredBy }),
          signature: input.signature,
        },
      });
      return data ?? fail(error);
    },

    /** Address of the key that signs quotes and receipts; fetched once and cached. */
    serviceAddress(): Promise<string> {
      serviceAddress ??= client
        .GET("/v1/service-key")
        .then(({ data, error }) => (data ? data.address : fail(error)));
      return serviceAddress;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
