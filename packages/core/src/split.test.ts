import {
  type Address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  type Instruction,
  type KeyPairSigner,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { beforeAll, describe, expect, it } from "vitest";
import { MAINNET, NETWORKS } from "./networks.js";
import {
  buildSplitTransaction,
  MAX_COMPUTE_UNIT_PRICE,
  MEMO_PROGRAM,
  type SplitParams,
  signSplitTransaction,
  splitMemo,
  verifySplitTransaction,
} from "./split.js";

const USDC = NETWORKS[MAINNET].usdc as Address;
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" as Address;
const BLOCKHASH = {
  blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"),
  lastValidBlockHeight: 291470237n,
};

const signer = (seed: number) =>
  createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));

let payer: KeyPairSigner;
let payee: KeyPairSigner;
let treasury: KeyPairSigner;
let other: KeyPairSigner;
let params: SplitParams;

beforeAll(async () => {
  [payer, payee, treasury, other] = await Promise.all([signer(1), signer(2), signer(3), signer(4)]);
  params = {
    network: MAINNET,
    payer: payer.address,
    payee: payee.address,
    treasury: treasury.address,
    paymentMint: USDC,
    paymentDecimals: 6,
    usdcDecimals: 6,
    payeeAmount: 9_975_000n,
    feeNet: 25_000n,
    receiptId: "q_test_0001",
    computeUnitLimit: 20_000,
    computeUnitPrice: 1_000n,
    lifetime: BLOCKHASH,
  };
});

const expectationOf = (p: SplitParams) => ({
  network: p.network,
  payee: p.payee,
  treasury: p.treasury,
  paymentMint: p.paymentMint,
  paymentDecimals: p.paymentDecimals,
  usdcDecimals: p.usdcDecimals,
  payeeAmount: p.payeeAmount,
  feeNet: p.feeNet,
  receiptId: p.receiptId,
});

const ata = async (owner: Address, mint: Address) =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

/** Builds an arbitrary transaction to test deviations the builder refuses to produce. */
async function rawTransaction(
  feePayer: Address,
  instructions: Instruction[],
  signers: KeyPairSigner[],
): Promise<string> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await partiallySignTransaction(
    signers.map((s) => s.keyPair),
    compileTransaction(message),
  );
  return getBase64EncodedWireTransaction(tx);
}

async function standardInstructions(p: SplitParams): Promise<Instruction[]> {
  return [
    getSetComputeUnitLimitInstruction({ units: p.computeUnitLimit }),
    getSetComputeUnitPriceInstruction({ microLamports: p.computeUnitPrice }),
    getTransferCheckedInstruction({
      source: await ata(p.payer, p.paymentMint),
      mint: p.paymentMint,
      destination: await ata(p.payee, p.paymentMint),
      authority: p.payer,
      amount: p.payeeAmount,
      decimals: p.paymentDecimals,
    }),
    getTransferCheckedInstruction({
      source: await ata(p.payer, USDC),
      mint: USDC,
      destination: await ata(p.treasury, USDC),
      authority: p.payer,
      amount: p.feeNet,
      decimals: p.usdcDecimals,
    }),
    getAddMemoInstruction({ memo: splitMemo(p.receiptId) }, { programAddress: MEMO_PROGRAM }),
  ];
}

const invalid = (reason: RegExp) =>
  expect.objectContaining({
    code: "PAYMENT_TRANSACTION_INVALID",
    message: expect.stringMatching(reason),
  });

describe("buildSplitTransaction (section G)", () => {
  it("returns an unsigned transaction with the 5-instruction layout", async () => {
    const wire = await buildSplitTransaction(params);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    expect(Object.keys(tx.signatures)).toEqual([payer.address]);
    expect(tx.signatures[payer.address]).toBeNull();
    const verified = await verifySplitTransaction(wire, expectationOf(params), { signed: false });
    expect(verified).toMatchObject({
      payer: payer.address,
      computeUnitLimit: 20_000,
      computeUnitPrice: 1_000n,
    });
  });

  it("is byte-identical to a hand-built transaction", async () => {
    const wire = await buildSplitTransaction(params);
    expect(wire).toBe(await rawTransaction(payer.address, await standardInstructions(params), []));
  });

  it("supports USDT payments with the fee in USDC", async () => {
    const p = { ...params, paymentMint: USDT };
    const wire = await buildSplitTransaction(p);
    await expect(
      verifySplitTransaction(wire, expectationOf(p), { signed: false }),
    ).resolves.toBeTruthy();
  });

  it("allows a zero net amount to the payee (F: $0.001 payment, $0.001 fee)", async () => {
    const p = { ...params, payeeAmount: 0n, feeNet: 1_000n };
    const wire = await buildSplitTransaction(p);
    await expect(
      verifySplitTransaction(wire, expectationOf(p), { signed: false }),
    ).resolves.toBeTruthy();
  });

  it("rejects a mint outside the whitelist", async () => {
    await expect(buildSplitTransaction({ ...params, paymentMint: other.address })).rejects.toThrow(
      expect.objectContaining({ code: "MINT_NOT_ALLOWED" }),
    );
  });

  it("rejects a compute unit price above the cap", async () => {
    await expect(
      buildSplitTransaction({ ...params, computeUnitPrice: MAX_COMPUTE_UNIT_PRICE + 1n }),
    ).rejects.toThrow(invalid(/compute unit price/));
  });

  it("caps the priority fee at 5 lamports per compute unit (D16)", () => {
    expect(MAX_COMPUTE_UNIT_PRICE).toBe(5_000_000n);
  });
});

describe("signSplitTransaction and verifySplitTransaction", () => {
  it("accepts a transaction signed by the payer", async () => {
    const signed = await signSplitTransaction(await buildSplitTransaction(params), payer.keyPair);
    const verified = await verifySplitTransaction(signed, expectationOf(params), { signed: true });
    expect(verified.payer).toBe(payer.address);
    expect(verified.signature).toEqual(expect.any(String));
  });

  it("rejects an unsigned transaction when a signature is required", async () => {
    const wire = await buildSplitTransaction(params);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/signature/));
  });

  it("rejects a signature from another key", async () => {
    const wire = await buildSplitTransaction(params);
    await expect(signSplitTransaction(wire, other.keyPair)).rejects.toThrow();
  });

  it("rejects a signed transaction whose message was altered", async () => {
    const signed = await signSplitTransaction(await buildSplitTransaction(params), payer.keyPair);
    const altered = await buildSplitTransaction({ ...params, receiptId: "q_test_0002" });
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(signed));
    const forged = getTransactionDecoder().decode(getBase64Encoder().encode(altered));
    const wire = getBase64EncodedWireTransaction({ ...forged, signatures: tx.signatures });
    await expect(
      verifySplitTransaction(
        wire,
        { ...expectationOf(params), receiptId: "q_test_0002" },
        { signed: true },
      ),
    ).rejects.toThrow(invalid(/signature/));
  });
});

describe("verifySplitTransaction rejects deviations from the quote", () => {
  const cases: [string, Partial<SplitParams>, RegExp][] = [
    ["net amount to the payee", { payeeAmount: 9_975_001n }, /instruction 2.*amount/],
    ["fee to the treasury", { feeNet: 24_999n }, /instruction 3.*amount/],
    [
      "payee",
      { payee: "11111111111111111111111111111111" as Address },
      /instruction 2.*destination/,
    ],
    [
      "treasury",
      { treasury: "11111111111111111111111111111111" as Address },
      /instruction 3.*destination/,
    ],
    ["payment mint", { paymentMint: USDT }, /instruction 2.*mint/],
    ["payment decimals", { paymentDecimals: 9 }, /instruction 2.*decimals/],
    ["receipt id", { receiptId: "q_other" }, /instruction 4.*memo/],
  ];
  it.each(cases)("%s", async (_name, change, reason) => {
    const wire = await buildSplitTransaction(params);
    await expect(
      verifySplitTransaction(wire, { ...expectationOf(params), ...change }, { signed: false }),
    ).rejects.toThrow(invalid(reason));
  });

  it("rejects a mint outside the whitelist even if the quote names it", async () => {
    const instructions = await standardInstructions(params);
    instructions[2] = getTransferCheckedInstruction({
      source: await ata(payer.address, other.address),
      mint: other.address,
      destination: await ata(payee.address, other.address),
      authority: payer.address,
      amount: params.payeeAmount,
      decimals: 6,
    });
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(
        wire,
        { ...expectationOf(params), paymentMint: other.address },
        { signed: true },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "MINT_NOT_ALLOWED" }));
  });

  it("rejects the fee in a token other than USDC", async () => {
    const p = { ...params, paymentMint: USDT };
    const instructions = await standardInstructions(p);
    instructions[3] = getTransferCheckedInstruction({
      source: await ata(payer.address, USDT),
      mint: USDT,
      destination: await ata(treasury.address, USDT),
      authority: payer.address,
      amount: p.feeNet,
      decimals: 6,
    });
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(verifySplitTransaction(wire, expectationOf(p), { signed: true })).rejects.toThrow(
      invalid(/instruction 3.*mint/),
    );
  });

  it("rejects a compute unit price above the cap", async () => {
    const instructions = await standardInstructions(params);
    instructions[1] = getSetComputeUnitPriceInstruction({
      microLamports: MAX_COMPUTE_UNIT_PRICE + 1n,
    });
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/compute unit price/));
  });

  it("rejects instructions in a different order", async () => {
    const instructions = await standardInstructions(params);
    [instructions[2], instructions[3]] = [
      instructions[3] as Instruction,
      instructions[2] as Instruction,
    ];
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/instruction 2/));
  });

  it("rejects an extra instruction", async () => {
    const instructions = await standardInstructions(params);
    instructions.push(getAddMemoInstruction({ memo: "extra" }));
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/5 instructions/));
  });

  it("rejects a missing instruction", async () => {
    const instructions = (await standardInstructions(params)).slice(0, 4);
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/5 instructions/));
  });

  it("rejects a fee payer other than the payer (m2m never pays gas)", async () => {
    const wire = await rawTransaction(other.address, await standardInstructions(params), [other]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/instruction 2: authority is not the payer/));
  });

  it("rejects a second signer", async () => {
    const instructions = await standardInstructions(params);
    instructions[2] = getTransferCheckedInstruction({
      source: await ata(other.address, params.paymentMint),
      mint: params.paymentMint,
      destination: await ata(payee.address, params.paymentMint),
      authority: other,
      amount: params.payeeAmount,
      decimals: 6,
    });
    const wire = await rawTransaction(payer.address, instructions, [payer, other]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/one signer/));
  });

  it("rejects garbage", async () => {
    await expect(
      verifySplitTransaction("not a transaction", expectationOf(params), { signed: false }),
    ).rejects.toThrow(invalid(/decode/));
  });
});

describe("memo program (D38)", () => {
  it("uses the immutable SPL Memo v2 and rejects any other memo program", async () => {
    expect(MEMO_PROGRAM).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const instructions = await standardInstructions(params);
    instructions[4] = getAddMemoInstruction({ memo: splitMemo(params.receiptId) });
    const wire = await rawTransaction(payer.address, instructions, [payer]);
    await expect(
      verifySplitTransaction(wire, expectationOf(params), { signed: true }),
    ).rejects.toThrow(invalid(/instruction 4/));
  });
});
