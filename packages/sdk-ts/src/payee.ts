// Payee side (section G, steps 3 and 4): verify, simulate and submit. The payee never signs.
import {
  type SignedQuote,
  type SolanaRpc,
  submitAndConfirm,
  type VerifiedSplit,
  verifySignedPayment,
} from "@m2m-monster/core";

export interface VerifyPaymentOptions {
  rpc: SolanaRpc;
  /** The quote this payee obtained for the payment. */
  quote: SignedQuote;
  /** Base64 transaction signed by the payer. */
  transaction: string;
  serviceAddress: string;
  now?: () => number;
}

/**
 * Checks net amount, fee to the treasury, whitelisted mints, quote id and expiry, the payer's
 * signature, and simulates the transaction before it is submitted (sections G, K).
 */
export async function verifyPayment(options: VerifyPaymentOptions): Promise<VerifiedSplit> {
  return verifySignedPayment({
    rpc: options.rpc,
    quote: options.quote,
    transaction: options.transaction,
    serviceAddress: options.serviceAddress,
    nowSeconds: Math.floor((options.now ?? Date.now)() / 1000),
  });
}

/** Broadcasts the verified, fully signed transaction and waits for confirmation. */
export async function submitPayment(options: {
  rpc: SolanaRpc;
  transaction: string;
}): Promise<string> {
  return submitAndConfirm(options.rpc, options.transaction);
}
