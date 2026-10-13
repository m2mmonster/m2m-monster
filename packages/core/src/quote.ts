// Quotes (sections C, F, G, K; decisions D1, D7): priced by the API, signed by the service key.
import {
  type Address,
  type generateKeyPair,
  getBase58Decoder,
  getBase58Encoder,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  type SignatureBytes,
  signBytes,
  verifySignature,
} from "@solana/kit";
import { M2mError } from "./errors.js";
import { agentFee, applyDiscounts, type FeeBreakdown, feeInTokenUnits } from "./fees.js";
import { allowedMint, isNetwork, NETWORKS, type Network } from "./networks.js";
import type { SplitExpectation } from "./split.js";

/** Wire format of a quote. Amounts are strings of base units; `expires_at` is unix seconds. */
export interface Quote {
  /** Quote id; also the receipt id written in the memo. */
  id: string;
  nonce: string;
  network: Network;
  /** Payment mint and its on-chain decimals. */
  mint: string;
  decimals: number;
  /** Gross amount the payer pays, in payment token base units. */
  amount: string;
  payee: string;
  /** amount − fee_net, in payment token base units (D1). */
  payee_amount: string;
  treasury: string;
  usdc_mint: string;
  usdc_decimals: number;
  fee_gross: string;
  discount: string;
  fee_net: string;
  expires_at: number;
  /** Referral link of the payee (section C). */
  referral: string;
}

export interface SignedQuote extends Quote {
  /** Base58 ed25519 signature of `quoteMessage(quote)` by the service key. */
  signature: string;
}

export interface SplitPrice extends FeeBreakdown {
  payeeAmount: bigint;
}

/** Fee, discounts and the payee's net amount for a payment of a 1-USD token. */
export function priceSplit(input: {
  amount: bigint;
  decimals: number;
  referred: boolean;
  credits: bigint;
}): SplitPrice {
  const feeGross = agentFee(input.amount, input.decimals);
  const breakdown = applyDiscounts({ feeGross, referred: input.referred, credits: input.credits });
  return {
    ...breakdown,
    payeeAmount: input.amount - feeInTokenUnits(breakdown.feeNet, input.decimals),
  };
}

const QUOTE_FIELDS = [
  "amount",
  "decimals",
  "discount",
  "expires_at",
  "fee_gross",
  "fee_net",
  "id",
  "mint",
  "network",
  "nonce",
  "payee",
  "payee_amount",
  "referral",
  "treasury",
  "usdc_decimals",
  "usdc_mint",
] as const satisfies readonly (keyof Quote)[];

/** Canonical form to sign: JSON with keys sorted and no whitespace. */
export function quoteMessage(quote: Quote): string {
  return JSON.stringify(Object.fromEntries(QUOTE_FIELDS.map((k) => [k, quote[k]])));
}

export async function signQuote(
  quote: Quote,
  privateKey: Parameters<typeof signBytes>[0],
): Promise<string> {
  const signature = await signBytes(privateKey, getUtf8Encoder().encode(quoteMessage(quote)));
  return getBase58Decoder().decode(signature);
}

export async function verifyQuote(quote: SignedQuote, serviceAddress: string): Promise<boolean> {
  try {
    const signature = getBase58Encoder().encode(quote.signature);
    if (signature.length !== 64) return false;
    return await verifySignature(
      await getPublicKeyFromAddress(serviceAddress as Address),
      signature as SignatureBytes,
      getUtf8Encoder().encode(quoteMessage(quote)),
    );
  } catch {
    return false;
  }
}

export function assertQuoteFresh(quote: Quote, nowSeconds: number): void {
  if (nowSeconds > quote.expires_at) throw new M2mError("QUOTE_EXPIRED");
}

/**
 * Checks a quote before paying or accepting a payment: service signature, expiry, the
 * network's treasury and USDC mint, and the mint whitelist (sections E, G, K; D7).
 */
export async function assertQuoteValid(
  quote: SignedQuote,
  serviceAddress: string,
  nowSeconds: number,
): Promise<void> {
  if (!(await verifyQuote(quote, serviceAddress))) throw new M2mError("QUOTE_INVALID");
  assertQuoteFresh(quote, nowSeconds);
  const network = isNetwork(quote.network) ? NETWORKS[quote.network] : undefined;
  if (
    !network?.treasury ||
    quote.treasury !== network.treasury ||
    quote.usdc_mint !== network.usdc
  ) {
    throw new M2mError(
      "QUOTE_INVALID",
      "The quote does not use this network's treasury or USDC mint.",
    );
  }
  if (!allowedMint(quote.network, quote.mint)) throw new M2mError("MINT_NOT_ALLOWED");
}

/** What the payee checks the payer's transaction against (section G, step 3). */
export function splitExpectation(quote: Quote): SplitExpectation {
  return {
    network: quote.network,
    payee: quote.payee as Address,
    treasury: quote.treasury as Address,
    paymentMint: quote.mint as Address,
    paymentDecimals: quote.decimals,
    usdcDecimals: quote.usdc_decimals,
    payeeAmount: BigInt(quote.payee_amount),
    feeNet: BigInt(quote.fee_net),
    receiptId: quote.id,
  };
}

/** An ed25519 key pair as returned by @solana/kit. */
export type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
