import { readFileSync } from "node:fs";
import {
  blockhash,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressFromPublicKey,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { type Quote, splitExpectation } from "./quote.js";
import { receiptFromQuote, signReceipt } from "./receipt.js";
import { verifyReceipt } from "./rpc.js";
import { buildSplitTransaction, signSplitTransaction } from "./split.js";
import { mockRpc, signatureOf } from "./test-rpc.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/quote.json", import.meta.url), "utf8"),
);
const quote: Quote = vectors.quote;

let keys: CryptoKeyPair;
let service: string;
let payer: KeyPairSigner;
let wire: string;

beforeAll(async () => {
  keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9));
  service = await getAddressFromPublicKey(keys.publicKey);
  payer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
  const unsigned = await buildSplitTransaction({
    ...splitExpectation(quote),
    payer: payer.address,
    computeUnitLimit: 20_000,
    computeUnitPrice: 0n,
    lifetime: {
      blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"),
      lastValidBlockHeight: 1n,
    },
  });
  wire = await signSplitTransaction(unsigned, payer.keyPair);
});

const receiptFor = (q: Quote, transaction: string, payerAddress: string = payer.address) =>
  signReceipt(
    receiptFromQuote(q, { payer: payerAddress, transaction, issuedAt: 1 }),
    keys.privateKey,
    service,
  );

describe("verifyReceipt against the chain (section L, verify_receipt)", () => {
  it("accepts a receipt whose transaction is confirmed and matches", async () => {
    const { rpc, state } = mockRpc();
    state.transactions.set(signatureOf(wire), { wire, err: null });
    const result = await verifyReceipt(rpc, await receiptFor(quote, signatureOf(wire)), service);
    expect(result.receipt.id).toBe(quote.id);
    expect(result.slot).toBe(7n);
  });

  it("rejects when the transaction is not on-chain", async () => {
    const { rpc } = mockRpc();
    await expect(
      verifyReceipt(rpc, await receiptFor(quote, signatureOf(wire)), service),
    ).rejects.toThrow(expect.objectContaining({ code: "RECEIPT_INVALID" }));
  });

  it("rejects when the transaction failed on-chain", async () => {
    const { rpc, state } = mockRpc();
    state.transactions.set(signatureOf(wire), { wire, err: { InstructionError: [2, "x"] } });
    await expect(
      verifyReceipt(rpc, await receiptFor(quote, signatureOf(wire)), service),
    ).rejects.toThrow(expect.objectContaining({ code: "TRANSACTION_FAILED" }));
  });

  it("rejects a receipt whose amounts differ from the transaction", async () => {
    const { rpc, state } = mockRpc();
    state.transactions.set(signatureOf(wire), { wire, err: null });
    const jws = await receiptFor({ ...quote, fee_net: "24000" }, signatureOf(wire));
    await expect(verifyReceipt(rpc, jws, service)).rejects.toThrow(
      expect.objectContaining({ code: "RECEIPT_INVALID" }),
    );
  });

  it("rejects a receipt naming another payer", async () => {
    const { rpc, state } = mockRpc();
    state.transactions.set(signatureOf(wire), { wire, err: null });
    const jws = await receiptFor(quote, signatureOf(wire), quote.payee);
    await expect(verifyReceipt(rpc, jws, service)).rejects.toThrow(
      expect.objectContaining({ code: "RECEIPT_INVALID" }),
    );
  });
});
