// Payment preparation and verification shared by the SDKs, the API and the MCP server
// (section G, steps 2 and 3; section K). Nothing here signs: transactions come back unsigned.
import type { Address, Blockhash } from "@solana/kit";
import { M2mError } from "./errors.js";
import { assertQuoteValid, type SignedQuote, splitExpectation } from "./quote.js";
import {
  associatedTokenAccount,
  estimateComputeUnitPrice,
  type SolanaRpc,
  simulate,
  tokenBalance,
} from "./rpc.js";
import {
  buildSplitTransaction,
  MAX_COMPUTE_UNIT_PRICE,
  type VerifiedSplit,
  verifySplitTransaction,
} from "./split.js";

/** Simulation may use at most this many compute units. */
const PROVISIONAL_COMPUTE_UNIT_LIMIT = 1_400_000;

export interface PreparedTransaction {
  /** Base64 wire transaction, unsigned. */
  transaction: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  lastValidBlockHeight: bigint;
}

export interface BuildParams {
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}

/**
 * Builds with the maximum compute unit limit, simulates, sets the limit to 1.2 × units
 * consumed and simulates the final transaction (section K; D16, D30).
 */
export async function buildSimulated(
  rpc: SolanaRpc,
  writableAccounts: Address[],
  maxComputeUnitPrice: bigint,
  build: (params: BuildParams) => Promise<string>,
): Promise<PreparedTransaction> {
  const computeUnitPrice = await estimateComputeUnitPrice(
    rpc,
    writableAccounts,
    maxComputeUnitPrice,
  );
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const at = (computeUnitLimit: number) => build({ computeUnitLimit, computeUnitPrice, lifetime });
  const consumed = await simulate(rpc, await at(PROVISIONAL_COMPUTE_UNIT_LIMIT), {
    sigVerify: false,
  });
  const computeUnitLimit = Math.ceil(Number(consumed) * 1.2);
  const transaction = await at(computeUnitLimit);
  await simulate(rpc, transaction, { sigVerify: false });
  return {
    transaction,
    computeUnitLimit,
    computeUnitPrice,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  };
}

/**
 * Payer side before signing: checks the quote, that the payee and treasury token accounts
 * exist and the USDC balance for the fee, then builds and simulates the unsigned m2m-split.
 */
export async function preparePayment(options: {
  rpc: SolanaRpc;
  payer: Address;
  quote: SignedQuote;
  serviceAddress: string;
  maxComputeUnitPrice?: bigint;
  nowSeconds: number;
}): Promise<PreparedTransaction> {
  const { rpc, payer, quote } = options;
  await assertQuoteValid(quote, options.serviceAddress, options.nowSeconds);
  const expected = splitExpectation(quote);
  const usdc = quote.usdc_mint as Address;

  // Never create accounts inside a payment (section K).
  const [payeeBalance, treasuryBalance, payerUsdc] = await Promise.all([
    tokenBalance(rpc, expected.payee, expected.paymentMint),
    tokenBalance(rpc, expected.treasury, usdc),
    tokenBalance(rpc, payer, usdc),
  ]);
  if (payeeBalance === undefined || treasuryBalance === undefined) {
    throw new M2mError("RECEIVER_TOKEN_ACCOUNT_MISSING");
  }
  // The fee is always paid in USDC; never convert another token to cover it (rule 6).
  if ((payerUsdc ?? 0n) < expected.feeNet) throw new M2mError("FEE_BALANCE_INSUFFICIENT_USDC");

  const writable = await Promise.all([
    associatedTokenAccount(payer, expected.paymentMint),
    associatedTokenAccount(expected.payee, expected.paymentMint),
    associatedTokenAccount(payer, usdc),
    associatedTokenAccount(expected.treasury, usdc),
  ]);
  return buildSimulated(
    rpc,
    writable,
    options.maxComputeUnitPrice ?? MAX_COMPUTE_UNIT_PRICE,
    (params) => buildSplitTransaction({ ...expected, payer, ...params }),
  );
}

/**
 * Payee side before submitting: quote checks, strict layout with the payer signature and a
 * simulation with signature checks (section G, step 3).
 */
export async function verifySignedPayment(options: {
  rpc: SolanaRpc;
  quote: SignedQuote;
  transaction: string;
  serviceAddress: string;
  nowSeconds: number;
}): Promise<VerifiedSplit> {
  await assertQuoteValid(options.quote, options.serviceAddress, options.nowSeconds);
  const verified = await verifySplitTransaction(
    options.transaction,
    splitExpectation(options.quote),
    { signed: true },
  );
  await simulate(options.rpc, options.transaction, { sigVerify: true });
  return verified;
}
