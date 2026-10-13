import { readFileSync } from "node:fs";
import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getUtf8Decoder,
} from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { parseTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { beforeEach, describe, expect, it } from "vitest";
import type { Quote } from "./quote.js";
import { type Receipt, receiptFromQuote } from "./receipt.js";
import { prepareRefund, REFUND_MEMO_PREFIX } from "./refund.js";
import { associatedTokenAccount } from "./rpc.js";
import { MEMO_PROGRAM } from "./split.js";
import { type MockRpcState, mockRpc, putTokenAccount } from "./test-rpc.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/quote.json", import.meta.url), "utf8"),
);
const quote: Quote = vectors.quote;

let receipt: Receipt;
let rpc: ReturnType<typeof mockRpc>["rpc"];
let state: MockRpcState;

beforeEach(async () => {
  const payer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
  receipt = receiptFromQuote(quote, { payer: payer.address, transaction: "sig", issuedAt: 1 });
  ({ rpc, state } = mockRpc());
  const mint = quote.mint as Address;
  putTokenAccount(
    state,
    await associatedTokenAccount(payer.address, mint),
    payer.address,
    mint,
    0n,
  );
});

function decode(wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const message = decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(tx.messageBytes),
  );
  return { tx, message };
}

describe("build_refund (sections I, K; D10)", () => {
  it("builds an unsigned payee -> payer transfer with no treasury transfer", async () => {
    const { transaction } = await prepareRefund({ rpc, receipt, amount: 5_000_000n });
    const { tx, message } = decode(transaction);

    expect(message.feePayer.address).toBe(receipt.payee);
    expect(Object.values(tx.signatures)).toEqual([null]);
    expect(message.instructions.map((i) => i.programAddress)).toEqual([
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
      MEMO_PROGRAM,
    ]);
    const transfer = parseTransferCheckedInstruction(message.instructions[2] as never);
    expect(transfer.accounts.authority.address).toBe(receipt.payee);
    expect(transfer.accounts.mint.address).toBe(receipt.mint);
    expect(transfer.accounts.destination.address).toBe(
      await associatedTokenAccount(receipt.payer as Address, receipt.mint as Address),
    );
    expect(transfer.data.amount).toBe(5_000_000n);
    expect(getUtf8Decoder().decode(message.instructions[3]?.data as Uint8Array)).toBe(
      `${REFUND_MEMO_PREFIX} ${receipt.id}`,
    );
  });

  it("allows refunding up to the original gross amount; the fee is not returned", async () => {
    await expect(prepareRefund({ rpc, receipt, amount: 10_000_000n })).resolves.toBeTruthy();
    await expect(prepareRefund({ rpc, receipt, amount: 10_000_001n })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    await expect(prepareRefund({ rpc, receipt, amount: 0n })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("refuses when the payer token account is missing", async () => {
    state.accounts.clear();
    await expect(prepareRefund({ rpc, receipt, amount: 1n })).rejects.toThrow(
      expect.objectContaining({ code: "RECEIVER_TOKEN_ACCOUNT_MISSING" }),
    );
  });

  it("simulates before returning it", async () => {
    state.simulation = { err: { InstructionError: [2, { Custom: 1 }] }, logs: [] };
    await expect(prepareRefund({ rpc, receipt, amount: 1n })).rejects.toThrow(
      expect.objectContaining({ code: "SIMULATION_FAILED" }),
    );
  });
});
