// Retrying a payment without paying twice (section K: "a retry never creates a second payment";
// D54, D66). The payer keeps each signed payment until its outcome is known and decides from
// evidence: the seller's answer, a verified receipt and the transaction's status on-chain.
import type { Receipt, SolanaRpc } from "@m2m-monster/core";
import type { Signature } from "@solana/kit";

/** What the seller answered to a payment the payer signed. */
export type SettlementEvidence =
  /** PAYMENT-RESPONSE success for this payment's transaction. */
  | "success"
  /** 402 QUOTE_EXPIRED carrying a transaction and a receipt. */
  | "quote_expired_with_receipt"
  /** 402 QUOTE_EXPIRED without a transaction or receipt. */
  | "quote_expired_without_receipt"
  /** Anything else: another error, no PAYMENT-RESPONSE, another status. */
  | "other";

export type SignatureEvidence =
  | "finalized"
  | "confirmed"
  | "processed"
  | "failed"
  | "not_found"
  | "rpc_error";

export interface RetryEvidence {
  settlement: SettlementEvidence;
  /** Receipt verification (service signature, on-chain transaction, this payment's signature). */
  receipt: "valid" | "invalid" | null;
  /** Status of this payment's signature, searching the transaction history. */
  signature_status: SignatureEvidence | null;
  /** Whether the blockhash can no longer be used (finalized block height above its last valid). */
  blockhash_expired: boolean | "rpc_error" | null;
}

/** `unknown`: the SDK must not pay again and raises PAYMENT_STATUS_UNKNOWN. */
export type RetryDecision = "paid" | "already_paid" | "not_paid" | "unknown";

/** Pure decision shared with the Python SDK through spec/test-vectors/retry.json. */
export function decideRetry(e: RetryEvidence): RetryDecision {
  if (e.settlement === "success") return "paid";
  if (e.settlement === "quote_expired_with_receipt" && e.receipt === "valid") return "already_paid";
  if (e.signature_status === "confirmed" || e.signature_status === "finalized") {
    return "already_paid";
  }
  // A failed transaction moved no tokens and can never execute again.
  if (e.signature_status === "failed") return "not_paid";
  // Not paid only with proof that it did not land and that it never can.
  if (e.signature_status === "not_found" && e.blockhash_expired === true) return "not_paid";
  return "unknown";
}

/**
 * Chain evidence for a signed payment (D66, D67).
 *
 * The blockhash is checked first: `getEpochInfo` at `finalized` gives the finalized block height
 * and its slot in one answer. A finalized block above `lastValidBlockHeight` means no block that
 * could still include the transaction can ever become final. Then the signature status, searching
 * the history. "Not found" counts only if that answer was evaluated at or after the finalized slot
 * seen before; a lagging node behind a load balancer would otherwise report "not found" for a
 * transaction it has not seen yet. Malformed answers count as RPC errors.
 */
export async function chainEvidence(
  rpc: SolanaRpc,
  signature: string,
  lastValidBlockHeight: bigint,
): Promise<Pick<RetryEvidence, "signature_status" | "blockhash_expired">> {
  let blockhash_expired: RetryEvidence["blockhash_expired"] = "rpc_error";
  let finalizedSlot: bigint | undefined;
  try {
    const info = await rpc.getEpochInfo({ commitment: "finalized" }).send();
    if (typeof info?.blockHeight === "bigint" && typeof info.absoluteSlot === "bigint") {
      blockhash_expired = info.blockHeight > lastValidBlockHeight;
      finalizedSlot = info.absoluteSlot;
    }
  } catch {
    // stays rpc_error
  }
  let signature_status: SignatureEvidence = "rpc_error";
  try {
    const answer = await rpc
      .getSignatureStatuses([signature as Signature], { searchTransactionHistory: true })
      .send();
    const status = answer?.value?.[0];
    const contextSlot = answer?.context?.slot;
    if (status === null) {
      const fresh =
        typeof contextSlot === "bigint" &&
        (finalizedSlot === undefined || contextSlot >= finalizedSlot);
      if (fresh) signature_status = "not_found";
    } else if (status && typeof status === "object") {
      signature_status = status.err
        ? "failed"
        : status.confirmationStatus === "finalized" || status.confirmationStatus === "confirmed"
          ? status.confirmationStatus
          : "processed";
    }
  } catch {
    // stays rpc_error
  }
  return { signature_status, blockhash_expired };
}

/** Outcome of a request that carried a payment, read with `paymentOutcome(response)`. */
export interface PaymentOutcome {
  /**
   * `paid`: this response settled the payment. `already_paid`: an earlier attempt settled it
   * (verified receipt, or the transaction is confirmed on-chain). `not_paid`: proven not settled
   * (failed on-chain, or not found after its blockhash expired); a new request pays again.
   */
  status: "paid" | "already_paid" | "not_paid";
  paymentId: string;
  /** Signature of the payer's transaction. */
  transaction: string;
  /** Receipt JWS from the seller, when it sent one. */
  receipt?: string;
  /** Receipt payload, only when the SDK verified the receipt (already_paid). */
  receiptData?: Receipt;
}

/** Binds a payment to its request: the caller's Idempotency-Key, else method, URL and body. */
export async function requestKey(request: Request): Promise<string> {
  const explicit = request.headers.get("idempotency-key");
  if (explicit) return `idempotency-key:${explicit}`;
  const body = await request.clone().arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${request.method} ${request.url} ${hex}`;
}
