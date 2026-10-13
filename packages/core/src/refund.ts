// Refunds (sections I, K; decision D10): a new transfer from the payee back to the payer, built
// unsigned for the payee to sign. No treasury transfer; the original fee is not returned.
import {
  type Address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferCheckedInstruction } from "@solana-program/token";
import { M2mError } from "./errors.js";
import { buildSimulated, type PreparedTransaction } from "./payment.js";
import type { Receipt } from "./receipt.js";
import { associatedTokenAccount, type SolanaRpc, tokenBalance } from "./rpc.js";
import { MAX_COMPUTE_UNIT_PRICE, MEMO_PROGRAM } from "./split.js";

export const REFUND_MEMO_PREFIX = "refund via m2m.monster";

/** Builds the unsigned refund of `amount` (at most the original gross amount) for a receipt. */
export async function prepareRefund(options: {
  rpc: SolanaRpc;
  /** A receipt whose service signature was already checked. */
  receipt: Receipt;
  amount: bigint;
  maxComputeUnitPrice?: bigint;
}): Promise<PreparedTransaction> {
  const { rpc, receipt, amount } = options;
  if (amount <= 0n || amount > BigInt(receipt.amount)) {
    throw new M2mError(
      "INVALID_REQUEST",
      "The refund amount must be positive and at most the original amount.",
    );
  }
  const payee = receipt.payee as Address;
  const payer = receipt.payer as Address;
  const mint = receipt.mint as Address;
  if ((await tokenBalance(rpc, payer, mint)) === undefined) {
    throw new M2mError("RECEIVER_TOKEN_ACCOUNT_MISSING");
  }
  const [source, destination] = await Promise.all([
    associatedTokenAccount(payee, mint),
    associatedTokenAccount(payer, mint),
  ]);

  return buildSimulated(
    rpc,
    [source, destination],
    options.maxComputeUnitPrice ?? MAX_COMPUTE_UNIT_PRICE,
    async ({ computeUnitLimit, computeUnitPrice, lifetime }) => {
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        // The payee pays its own gas and signs; m2m never does (rule 3).
        (m) => setTransactionMessageFeePayer(payee, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
        (m) =>
          appendTransactionMessageInstructions(
            [
              getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
              getSetComputeUnitPriceInstruction({ microLamports: computeUnitPrice }),
              getTransferCheckedInstruction({
                source,
                mint,
                destination,
                authority: payee,
                amount,
                decimals: receipt.decimals,
              }),
              getAddMemoInstruction(
                { memo: `${REFUND_MEMO_PREFIX} ${receipt.id}` },
                { programAddress: MEMO_PROGRAM },
              ),
            ],
            m,
          ),
      );
      return getBase64EncodedWireTransaction(compileTransaction(message));
    },
  );
}
