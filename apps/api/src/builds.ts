// Endpoints that build or check transactions without signing them (rule 4; sections G, K, L).
// Agents sign locally; these back the MCP tools build_payment, verify_payment and build_refund.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  M2mError,
  type PreparedTransaction,
  preparePayment,
  prepareRefund,
  pricing,
  type SignedQuote,
  verifyReceiptSignature,
  verifySignedPayment,
} from "@m2m-monster/core";
import type { Address } from "@solana/kit";
import type { AppDeps } from "./app.js";
import { status } from "./public.js";
import { SignedQuoteSchema } from "./quotes.js";
import { BaseUnits, errorResponses, Pubkey } from "./schemas.js";

const Unsigned = z
  .object({
    transaction: z.string().openapi({ description: "Base64 wire transaction, unsigned" }),
    compute_unit_limit: z.number().int(),
    compute_unit_price: z.string().openapi({ description: "Micro-lamports per compute unit" }),
    last_valid_block_height: z.string(),
  })
  .openapi("UnsignedTransaction");

const unsigned = (p: PreparedTransaction) => ({
  transaction: p.transaction,
  compute_unit_limit: p.computeUnitLimit,
  compute_unit_price: `${p.computeUnitPrice}`,
  last_valid_block_height: `${p.lastValidBlockHeight}`,
});

const MaxPrice = z
  .string()
  .regex(/^\d+$/)
  .optional()
  .openapi({ description: "Lower priority fee cap in micro-lamports/CU (at most 5,000,000)" });

const ok = (description: string, schema: z.ZodType) => ({
  200: { description, content: { "application/json": { schema } } },
});

const buildPaymentRoute = createRoute({
  method: "post",
  path: "/v1/payments/build",
  summary:
    "Build the unsigned m2m-split transaction for the payer to sign (checks accounts, USDC for the fee, simulates)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            quote: SignedQuoteSchema,
            payer: Pubkey,
            max_compute_unit_price: MaxPrice,
          }),
        },
      },
      required: true,
    },
  },
  responses: { ...ok("Unsigned transaction", Unsigned), ...errorResponses(400, 410, 429, 500) },
});

const verifyPaymentRoute = createRoute({
  method: "post",
  path: "/v1/payments/verify",
  summary:
    "For the payee: verify a payer-signed transaction against its quote and simulate it, before submitting",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ quote: SignedQuoteSchema, transaction: z.string().min(1).max(2048) }),
        },
      },
      required: true,
    },
  },
  responses: {
    ...ok(
      "The payment is valid",
      z.object({ valid: z.literal(true), payer: Pubkey, signature: z.string() }),
    ),
    ...errorResponses(400, 410, 429, 500),
  },
});

const buildRefundRoute = createRoute({
  method: "post",
  path: "/v1/refunds/build",
  summary:
    "Build an unsigned refund from the payee back to the payer, linked to the receipt. No fee; the original fee is not returned.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            receipt: z.string().min(1).openapi({ description: "Receipt JWS" }),
            amount: BaseUnits.openapi({ description: "At most the original gross amount" }),
            max_compute_unit_price: MaxPrice,
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    ...ok("Unsigned refund for the payee to sign", Unsigned),
    ...errorResponses(400, 429, 500),
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/status.json",
  summary: "Service status and API version",
  responses: {
    ...ok(
      "Status",
      z.object({
        status: z.literal("ok"),
        api_version: z.string(),
        versions: z.array(z.string()),
        network: z.string(),
        service_key: z.string(),
        deprecations: z.array(z.string()),
      }),
    ),
  },
});

const pricingRoute = createRoute({
  method: "get",
  path: "/pricing.json",
  summary: "Agent-to-agent tariff, referral program and whitelisted tokens of this network",
  responses: { ...ok("Pricing", z.record(z.string(), z.unknown())) },
});

export function registerBuildRoutes(app: OpenAPIHono, deps: AppDeps) {
  const nowSeconds = () => Math.floor(deps.now() / 1000);
  const maxPrice = (value?: string) =>
    value === undefined ? {} : { maxComputeUnitPrice: BigInt(value) };

  app.openapi(buildPaymentRoute, async (c) => {
    const body = c.req.valid("json");
    const quote = body.quote as SignedQuote;
    if (quote.network !== deps.network) {
      throw new M2mError("INVALID_REQUEST", `This deployment serves ${deps.network} only.`);
    }
    const prepared = await preparePayment({
      rpc: deps.rpc,
      payer: body.payer as Address,
      quote,
      serviceAddress: deps.serviceAddress,
      nowSeconds: nowSeconds(),
      ...maxPrice(body.max_compute_unit_price),
    });
    return c.json(unsigned(prepared), 200);
  });

  app.openapi(verifyPaymentRoute, async (c) => {
    const body = c.req.valid("json");
    const verified = await verifySignedPayment({
      rpc: deps.rpc,
      quote: body.quote as SignedQuote,
      transaction: body.transaction,
      serviceAddress: deps.serviceAddress,
      nowSeconds: nowSeconds(),
    });
    return c.json(
      { valid: true as const, payer: verified.payer, signature: verified.signature ?? "" },
      200,
    );
  });

  app.openapi(buildRefundRoute, async (c) => {
    const body = c.req.valid("json");
    const receipt = await verifyReceiptSignature(body.receipt, deps.serviceAddress);
    const prepared = await prepareRefund({
      rpc: deps.rpc,
      receipt,
      amount: BigInt(body.amount),
      ...maxPrice(body.max_compute_unit_price),
    });
    return c.json(unsigned(prepared), 200);
  });

  app.openapi(pricingRoute, (c) => c.json(pricing(deps.network), 200));

  app.openapi(statusRoute, (c) => c.json(status(deps.network, deps.serviceAddress), 200));
}
