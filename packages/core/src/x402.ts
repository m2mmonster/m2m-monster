// x402 v2 wire format (github.com/x402-foundation/x402, specs/x402-specification-v2.md and
// transports-v2/http.md, checked 2026-10-08) and the m2m-split entry (section G; D15, D21).
import { M2mError } from "./errors.js";
import type { SignedQuote } from "./quote.js";

export const X402_VERSION = 2;
export const M2M_SPLIT = "m2m-split";

export const HEADERS = {
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE",
} as const;

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface Extension {
  info: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, Extension>;
}

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, { info: Record<string, unknown>; schema?: Record<string, unknown> }>;
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, { info: Record<string, unknown> }>;
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader<T>(header: string): T {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as T;
  } catch {
    throw new M2mError("INVALID_REQUEST", "Malformed x402 header.");
  }
}

const PAYMENT_IDENTIFIER: Extension = {
  info: { required: true },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      required: { type: "boolean" },
      id: { type: "string", minLength: 16, maxLength: 128 },
    },
    required: ["required"],
  },
};

/**
 * The 402 for an m2m-split payment: the signed quote travels in `extra` (section G fields:
 * gross and net amounts, mint, fee_gross, discount, fee_net, treasury, expiry, referral link).
 * Settlement happens before the resource runs, so the flow is declared `upfront`.
 */
export function paymentRequired(quote: SignedQuote, resource: ResourceInfo): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: `${HEADERS.paymentSignature} header is required`,
    resource,
    accepts: [
      {
        scheme: M2M_SPLIT,
        network: quote.network,
        amount: quote.amount,
        asset: quote.mint,
        payTo: quote.payee,
        maxTimeoutSeconds: 30,
        extra: { ...quote, paymentFlow: "upfront" },
      },
    ],
    extensions: {
      "payment-identifier": PAYMENT_IDENTIFIER,
      "m2m-referral": {
        info: { link: quote.referral },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { link: { type: "string" } },
        },
      },
    },
  };
}

/** The signed quote inside an m2m-split requirements entry. Its signature is checked later. */
export function quoteFromRequirements(requirements: PaymentRequirements): SignedQuote {
  if (requirements.scheme !== M2M_SPLIT || !requirements.extra) {
    throw new M2mError("INVALID_REQUEST", "Not an m2m-split payment requirement.");
  }
  const { paymentFlow: _flow, ...quote } = requirements.extra;
  return quote as unknown as SignedQuote;
}

/** The idempotency key of a payment (x402 `payment-identifier` extension; section K). */
export function paymentIdOf(payload: Pick<PaymentPayload, "extensions">): string | undefined {
  const id = payload.extensions?.["payment-identifier"]?.info?.id;
  return typeof id === "string" && id.length >= 16 && id.length <= 128 ? id : undefined;
}
