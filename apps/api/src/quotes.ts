// POST /v1/quotes (sections C, F, G, K; decisions D1, D7).
import { createRoute, z } from "@hono/zod-openapi";
import {
  allowedMint,
  M2mError,
  NETWORKS,
  priceSplit,
  type Quote,
  type SignedQuote,
  signQuote,
} from "@m2m-monster/core";
import type { AppDeps } from "./app.js";
import { BaseUnits, errorResponses, Pubkey } from "./schemas.js";

const QuoteRequest = z
  .object({
    network: z.string().openapi({ example: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }),
    mint: Pubkey.openapi({ example: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }),
    amount: BaseUnits.openapi({
      description: "Gross amount the payer pays, in base units of mint",
    }),
    payee: Pubkey.openapi({ description: "Wallet that receives the payment" }),
  })
  .openapi("QuoteRequest");

export const SignedQuoteSchema = z
  .object({
    id: z.string().openapi({ description: "Quote id; also the receipt id in the memo" }),
    nonce: z.string(),
    network: z.string(),
    mint: Pubkey,
    decimals: z.number().int(),
    amount: BaseUnits,
    payee: Pubkey,
    payee_amount: BaseUnits.openapi({ description: "amount − fee_net, in base units of mint" }),
    treasury: Pubkey,
    usdc_mint: Pubkey,
    usdc_decimals: z.number().int(),
    fee_gross: BaseUnits,
    discount: BaseUnits,
    fee_net: BaseUnits.openapi({ description: "Fee paid to the treasury, in USDC base units" }),
    expires_at: z.number().int().openapi({ description: "Unix seconds; quotes last 30 seconds" }),
    referral: z.string(),
    signature: z.string().openapi({ description: "Base58 ed25519 signature by the service key" }),
  })
  .openapi("Quote");

export const quoteRoute = createRoute({
  method: "post",
  path: "/v1/quotes",
  summary: "Price a payment: fee breakdown, net amount to the payee and a signed 30-second quote",
  request: {
    headers: z.object({
      "idempotency-key": z.string().min(8).max(128).openapi({ example: "pay-7f3c2a9e" }),
    }),
    body: { content: { "application/json": { schema: QuoteRequest } }, required: true },
  },
  responses: {
    201: {
      description: "Signed quote",
      content: { "application/json": { schema: SignedQuoteSchema } },
    },
    ...errorResponses(400, 409, 429, 500),
  },
});

export async function createQuote(
  deps: AppDeps,
  req: z.infer<typeof QuoteRequest>,
  ids: { id: string; nonce: string; expiresAt: number },
  discounts: { referred: boolean; credits: bigint } = { referred: false, credits: 0n },
): Promise<{ quote: SignedQuote; creditsUsed: bigint }> {
  if (!allowedMint(deps.network, req.mint)) throw new M2mError("MINT_NOT_ALLOWED");
  const usdc = NETWORKS[deps.network].usdc;
  const [decimals, usdcDecimals] = await Promise.all([
    deps.mintDecimals(req.mint),
    deps.mintDecimals(usdc),
  ]);
  const price = priceSplit({ amount: BigInt(req.amount), decimals, ...discounts });

  const quote: Quote = {
    id: ids.id,
    nonce: ids.nonce,
    network: deps.network,
    mint: req.mint,
    decimals,
    amount: req.amount,
    payee: req.payee,
    payee_amount: `${price.payeeAmount}`,
    treasury: deps.treasury,
    usdc_mint: usdc,
    usdc_decimals: usdcDecimals,
    fee_gross: `${price.feeGross}`,
    discount: `${price.discount}`,
    fee_net: `${price.feeNet}`,
    expires_at: ids.expiresAt,
    referral: `${deps.publicBaseUrl}/.well-known/mcp.json?ref=${req.payee}`,
  };
  return {
    quote: { ...quote, signature: await signQuote(quote, deps.serviceKeys.privateKey) },
    creditsUsed: price.creditsUsed,
  };
}
