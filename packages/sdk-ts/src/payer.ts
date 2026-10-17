// Payer side (section G, step 2; section K): check, build, simulate and sign locally.
import {
  preparePayment,
  type SignedQuote,
  type SolanaRpc,
  signSplitTransaction,
} from "@m2m-monster/core";
import type { KeyPairSigner } from "@solana/kit";

export interface PayQuoteOptions {
  rpc: SolanaRpc;
  /** The payer's own key pair. It never leaves this process. */
  signer: KeyPairSigner;
  quote: SignedQuote;
  /** Address of the m2m.monster service key (GET /v1/service-key). */
  serviceAddress: string;
  /** Lower priority fee cap, in micro-lamports per compute unit (at most 5 lamports/CU). */
  maxComputeUnitPrice?: bigint;
  now?: () => number;
}

export interface PaidQuote {
  /** Base64 transaction signed by the payer, ready for the payee. */
  transaction: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  /** Last block height at which the transaction's blockhash is valid. */
  lastValidBlockHeight: bigint;
}

export async function payQuote(options: PayQuoteOptions): Promise<PaidQuote> {
  const prepared = await preparePayment({
    rpc: options.rpc,
    payer: options.signer.address,
    quote: options.quote,
    serviceAddress: options.serviceAddress,
    ...(options.maxComputeUnitPrice !== undefined && {
      maxComputeUnitPrice: options.maxComputeUnitPrice,
    }),
    nowSeconds: Math.floor((options.now ?? Date.now)() / 1000),
  });
  return {
    transaction: await signSplitTransaction(prepared.transaction, options.signer.keyPair),
    computeUnitLimit: prepared.computeUnitLimit,
    computeUnitPrice: prepared.computeUnitPrice,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  };
}
