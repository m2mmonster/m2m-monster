// Solana RPC steps shared by the SDKs, the relay and the MCP server (sections G, K).
// The RPC only reads, simulates and broadcasts already-signed transactions.
import type { Address, Rpc, Signature, SolanaRpcApi } from "@solana/kit";
import {
  fetchMaybeToken,
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { M2mError } from "./errors.js";
import type { Network } from "./networks.js";
import { type Receipt, verifyReceiptSignature } from "./receipt.js";
import { MAX_COMPUTE_UNIT_PRICE, verifySplitTransaction } from "./split.js";

export type SolanaRpc = Rpc<SolanaRpcApi>;

export async function associatedTokenAccount(owner: Address, mint: Address): Promise<Address> {
  return (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
}

/** Decimals read from the mint account on-chain; never hard-coded (section E, D19). */
export async function mintDecimals(rpc: SolanaRpc, mint: Address): Promise<number> {
  const account = await fetchMint(rpc, mint);
  if (account.programAddress !== TOKEN_PROGRAM_ADDRESS) throw new M2mError("MINT_NOT_ALLOWED");
  return account.data.decimals;
}

/** Balance of the owner's associated token account, or undefined if it does not exist. */
export async function tokenBalance(
  rpc: SolanaRpc,
  owner: Address,
  mint: Address,
): Promise<bigint | undefined> {
  const account = await fetchMaybeToken(rpc, await associatedTokenAccount(owner, mint));
  if (!account.exists || account.programAddress !== TOKEN_PROGRAM_ADDRESS) return undefined;
  return account.data.amount;
}

/**
 * Network estimate of the compute unit price for the given writable accounts, clamped to the
 * cap (D16): the 75th percentile of recent non-zero prioritization fees, or 0.
 */
export async function estimateComputeUnitPrice(
  rpc: SolanaRpc,
  writableAccounts: Address[],
  cap: bigint = MAX_COMPUTE_UNIT_PRICE,
): Promise<bigint> {
  const recent = await rpc.getRecentPrioritizationFees(writableAccounts).send();
  const fees = recent
    .map((f) => BigInt(f.prioritizationFee))
    .filter((f) => f > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const estimate = fees.length ? (fees[Math.floor((fees.length - 1) * 0.75)] as bigint) : 0n;
  const limit = cap < MAX_COMPUTE_UNIT_PRICE ? cap : MAX_COMPUTE_UNIT_PRICE;
  return estimate < limit ? estimate : limit;
}

/** Simulates a wire transaction and returns the compute units it consumed (section K). */
export async function simulate(
  rpc: SolanaRpc,
  wire: string,
  options: { sigVerify: boolean },
): Promise<bigint> {
  // With signature checks the real blockhash must be kept; without them it is replaced.
  const config = options.sigVerify
    ? ({ encoding: "base64", sigVerify: true, commitment: "confirmed" } as const)
    : ({ encoding: "base64", replaceRecentBlockhash: true, commitment: "confirmed" } as const);
  const { value } = await rpc.simulateTransaction(wire as never, config).send();
  if (value.err || value.unitsConsumed === undefined) {
    const logs = (value.logs ?? []).slice(-5).join(" | ");
    throw new M2mError(
      "SIMULATION_FAILED",
      `Transaction simulation failed: ${JSON.stringify(value.err, (_k, v) => (typeof v === "bigint" ? `${v}` : v))}${logs ? ` — ${logs}` : ""}`,
    );
  }
  return BigInt(value.unitsConsumed);
}

/**
 * Broadcasts an already fully signed transaction and waits until it is confirmed.
 * Never signs or pays anything (rule 3).
 */
export async function submitAndConfirm(
  rpc: SolanaRpc,
  wire: string,
  options: { lastValidBlockHeight?: bigint; pollMs?: number; timeoutMs?: number } = {},
): Promise<Signature> {
  const signature = await rpc
    .sendTransaction(wire as never, { encoding: "base64", skipPreflight: true, maxRetries: 0n })
    .send();
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  const pollMs = options.pollMs ?? 1_000;
  let resent = Date.now();
  while (Date.now() < deadline) {
    const [status] = (await rpc.getSignatureStatuses([signature]).send()).value;
    if (status?.err) {
      throw new M2mError(
        "TRANSACTION_FAILED",
        `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
      );
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
    ) {
      return signature;
    }
    if (options.lastValidBlockHeight !== undefined) {
      const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > options.lastValidBlockHeight) break;
    }
    // Re-broadcast the same signed bytes while waiting; this can never create a second payment.
    if (Date.now() - resent > 2_000) {
      await rpc
        .sendTransaction(wire as never, { encoding: "base64", skipPreflight: true, maxRetries: 0n })
        .send()
        .catch(() => undefined);
      resent = Date.now();
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new M2mError(
    "TRANSACTION_FAILED",
    "The transaction was not confirmed before its blockhash expired.",
  );
}

/** A confirmed transaction as base64 wire bytes, or undefined if the RPC does not know it. */
export async function fetchConfirmedTransaction(
  rpc: SolanaRpc,
  signature: string,
): Promise<{ wire: string; slot: bigint; blockTime: bigint | null } | undefined> {
  const tx = await rpc
    .getTransaction(signature as Signature, {
      encoding: "base64",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
    .send();
  if (!tx) return undefined;
  if (tx.meta?.err) {
    throw new M2mError(
      "TRANSACTION_FAILED",
      `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
    );
  }
  return { wire: tx.transaction[0], slot: tx.slot, blockTime: tx.blockTime };
}

/**
 * Verifies a receipt against the on-chain signature (section L, verify_receipt): the service
 * signature, and that the confirmed transaction is exactly the m2m-split the receipt describes.
 */
export async function verifyReceipt(
  rpc: SolanaRpc,
  jws: string,
  serviceAddress: string,
): Promise<{ receipt: Receipt; slot: bigint }> {
  const receipt = await verifyReceiptSignature(jws, serviceAddress);
  const confirmed = await fetchConfirmedTransaction(rpc, receipt.transaction);
  if (!confirmed) throw new M2mError("RECEIPT_INVALID", "The receipt transaction is not on-chain.");
  const verified = await verifySplitTransaction(
    confirmed.wire,
    {
      network: receipt.network as Network,
      payee: receipt.payee as Address,
      treasury: receipt.treasury as Address,
      paymentMint: receipt.mint as Address,
      paymentDecimals: receipt.decimals,
      usdcDecimals: receipt.usdc_decimals,
      payeeAmount: BigInt(receipt.payee_amount),
      feeNet: BigInt(receipt.fee_net),
      receiptId: receipt.id,
    },
    { signed: true },
  ).catch(() => {
    throw new M2mError("RECEIPT_INVALID", "The on-chain transaction does not match the receipt.");
  });
  if (verified.payer !== receipt.payer || verified.signature !== receipt.transaction) {
    throw new M2mError("RECEIPT_INVALID", "The on-chain transaction does not match the receipt.");
  }
  return { receipt, slot: confirmed.slot };
}
