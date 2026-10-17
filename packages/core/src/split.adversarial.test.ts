// Adversarial review of m2m-split verification (sections G, K): an attacker builds transactions
// that deviate from the layout and tries to get them accepted as payment for a quote.
import {
  AccountRole,
  type Address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
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
import { DEVNET, NETWORKS } from "./networks.js";
import {
  buildSplitTransaction,
  MEMO_PROGRAM,
  type SplitExpectation,
  type SplitParams,
  splitMemo,
  verifySplitTransaction,
} from "./split.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const SYSTEM = "11111111111111111111111111111111" as Address;
const RECENT_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111" as Address;
const LIFETIME = {
  blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"),
  lastValidBlockHeight: 1_000n,
};

let payer: KeyPairSigner;
let payee: KeyPairSigner;
let attacker: KeyPairSigner;
let params: SplitParams;

beforeAll(async () => {
  const seed = (n: number) => createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(n));
  [payer, payee, attacker] = await Promise.all([seed(1), seed(2), seed(7)]);
  params = {
    network: DEVNET,
    payer: payer.address,
    payee: payee.address,
    treasury: TREASURY,
    paymentMint: USDC,
    paymentDecimals: 6,
    usdcDecimals: 6,
    payeeAmount: 9_975_000n,
    feeNet: 25_000n,
    receiptId: "q_adversarial",
    computeUnitLimit: 20_000,
    computeUnitPrice: 0n,
    lifetime: LIFETIME,
  };
});

const expected = (): SplitExpectation => ({
  network: params.network,
  payee: params.payee,
  treasury: params.treasury,
  paymentMint: params.paymentMint,
  paymentDecimals: 6,
  usdcDecimals: 6,
  payeeAmount: params.payeeAmount,
  feeNet: params.feeNet,
  receiptId: params.receiptId,
});

const ata = async (owner: Address, mint: Address, program: Address = TOKEN_PROGRAM_ADDRESS) =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram: program }))[0];

const transfer = async (to: Address, mint: Address, amount: bigint) =>
  getTransferCheckedInstruction({
    source: await ata(payer.address, mint),
    mint,
    destination: await ata(to, mint),
    authority: payer.address,
    amount,
    decimals: 6,
  });

/** The honest layout; each attack replaces or adds instructions. */
async function honest(): Promise<Instruction[]> {
  return [
    getSetComputeUnitLimitInstruction({ units: 20_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 0 }),
    await transfer(payee.address, USDC, params.payeeAmount),
    await transfer(TREASURY, USDC, params.feeNet),
    getAddMemoInstruction({ memo: splitMemo(params.receiptId) }, { programAddress: MEMO_PROGRAM }),
  ];
}

async function signed(instructions: Instruction[], version: 0 | "legacy" = 0): Promise<string> {
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(
    await partiallySignTransaction([payer.keyPair], compileTransaction(message)),
  );
}

const withTrailingByte = (ix: Instruction): Instruction => ({
  ...ix,
  data: new Uint8Array([...(ix.data ?? []), 0]),
});

const rejects = (wire: string, reason: RegExp, code = "PAYMENT_TRANSACTION_INVALID") =>
  expect(verifySplitTransaction(wire, expected(), { signed: true })).rejects.toThrow(
    expect.objectContaining({ code, message: expect.stringMatching(reason) }),
  );

describe("adversarial m2m-split transactions", () => {
  it("baseline: the honest layout verifies and equals the builder's bytes", async () => {
    const wire = await signed(await honest());
    await expect(verifySplitTransaction(wire, expected(), { signed: true })).resolves.toMatchObject(
      { payer: payer.address },
    );
    const built = await buildSplitTransaction({ ...params });
    const instructions = await honest();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(payer.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const unsigned = getBase64EncodedWireTransaction(compileTransaction(message));
    expect(built).toBe(unsigned);
  });

  it("fee to another treasury (attacker's USDC account)", async () => {
    const ixs = await honest();
    ixs[3] = await transfer(attacker.address, USDC, params.feeNet);
    await rejects(await signed(ixs), /instruction 3: destination/);
  });

  it("fee_net one unit lower", async () => {
    const ixs = await honest();
    ixs[3] = await transfer(TREASURY, USDC, params.feeNet - 1n);
    await rejects(await signed(ixs), /instruction 3: amount/);
  });

  it("net amount to the payee one unit lower", async () => {
    const ixs = await honest();
    ixs[2] = await transfer(payee.address, USDC, params.payeeAmount - 1n);
    await rejects(await signed(ixs), /instruction 2: amount/);
  });

  it("duplicated payment transfer as a sixth instruction", async () => {
    const ixs = await honest();
    ixs.push(await transfer(payee.address, USDC, params.payeeAmount));
    await rejects(await signed(ixs), /exactly 5 instructions/);
  });

  it("memo replaced by a second fee transfer", async () => {
    const ixs = await honest();
    ixs[4] = await transfer(TREASURY, USDC, params.feeNet);
    await rejects(await signed(ixs), /instruction 4: memo/);
  });

  it("payment in a mint outside the whitelist", async () => {
    const ixs = await honest();
    ixs[2] = await transfer(payee.address, attacker.address, params.payeeAmount);
    await expect(
      verifySplitTransaction(
        await signed(ixs),
        { ...expected(), paymentMint: attacker.address },
        { signed: true },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "MINT_NOT_ALLOWED" }));
  });

  it("transfer through Token-2022 instead of the SPL Token program", async () => {
    const ixs = await honest();
    ixs[2] = { ...(ixs[2] as Instruction), programAddress: TOKEN_2022 };
    await rejects(await signed(ixs), /instruction 2: expected a TransferChecked of the SPL Token/);
  });

  it("durable nonce (AdvanceNonceAccount first) to keep a signed payload valid past expiry", async () => {
    const advanceNonce: Instruction = {
      programAddress: SYSTEM,
      accounts: [
        { address: attacker.address, role: AccountRole.WRITABLE },
        { address: RECENT_BLOCKHASHES, role: AccountRole.READONLY },
        { address: payer.address, role: AccountRole.READONLY_SIGNER },
      ],
      data: new Uint8Array([4, 0, 0, 0]),
    };
    const ixs = await honest();
    ixs[0] = advanceNonce;
    await rejects(await signed(ixs), /instruction 0: expected SetComputeUnitLimit/);
  });

  it("other compute budget instructions (RequestHeapFrame) in place of the limit", async () => {
    const ixs = await honest();
    ixs[0] = { ...(ixs[0] as Instruction), data: new Uint8Array([1, 0, 0, 4, 0]) };
    await rejects(await signed(ixs), /instruction 0: expected SetComputeUnitLimit/);
  });

  it.each([
    [0, /instruction 0: expected SetComputeUnitLimit/],
    [1, /instruction 1: expected SetComputeUnitPrice/],
    [2, /instruction 2: expected a TransferChecked/],
    [3, /instruction 3: expected a TransferChecked/],
  ])("trailing bytes in instruction %i data", async (index, reason) => {
    const ixs = await honest();
    ixs[index] = withTrailingByte(ixs[index] as Instruction);
    await rejects(await signed(ixs), reason);
  });

  it("legacy (non-versioned) transaction", async () => {
    await rejects(await signed(await honest(), "legacy"), /version 0/);
  });
});

describe("shared adversarial vectors (spec/test-vectors/adversarial.json)", () => {
  it("records every attack with its exact rejection, for the Python SDK", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const file = new URL("../../../spec/test-vectors/adversarial.json", import.meta.url);
    const replace = async (index: number, ix: Instruction) => {
      const ixs = await honest();
      ixs[index] = ix;
      return signed(ixs);
    };
    const base = await honest();
    const cases: [string, Promise<string>][] = [
      [
        "fee to another treasury",
        (async () => replace(3, await transfer(attacker.address, USDC, params.feeNet)))(),
      ],
      [
        "fee_net one unit lower",
        (async () => replace(3, await transfer(TREASURY, USDC, params.feeNet - 1n)))(),
      ],
      [
        "net amount one unit lower",
        (async () => replace(2, await transfer(payee.address, USDC, params.payeeAmount - 1n)))(),
      ],
      [
        "duplicated payment as sixth instruction",
        (async () => signed([...base, await transfer(payee.address, USDC, params.payeeAmount)]))(),
      ],
      [
        "memo replaced by a second fee transfer",
        (async () => replace(4, await transfer(TREASURY, USDC, params.feeNet)))(),
      ],
      [
        "Token-2022 program",
        replace(2, { ...(base[2] as Instruction), programAddress: TOKEN_2022 }),
      ],
      [
        "RequestHeapFrame instead of the limit",
        replace(0, { ...(base[0] as Instruction), data: new Uint8Array([1, 0, 0, 4, 0]) }),
      ],
      ["trailing byte in instruction 0", replace(0, withTrailingByte(base[0] as Instruction))],
      ["trailing byte in instruction 1", replace(1, withTrailingByte(base[1] as Instruction))],
      ["trailing byte in instruction 2", replace(2, withTrailingByte(base[2] as Instruction))],
      ["trailing byte in instruction 3", replace(3, withTrailingByte(base[3] as Instruction))],
      ["legacy transaction", signed(base, "legacy")],
    ];
    const vectors = [];
    for (const [name, wirePromise] of cases) {
      const transaction = await wirePromise;
      const error = await verifySplitTransaction(transaction, expected(), { signed: true }).catch(
        (e) => e,
      );
      expect(error, name).toHaveProperty("code");
      vectors.push({ name, transaction, code: error.code, reason: error.message });
    }
    const json = `${JSON.stringify(
      {
        description:
          "Adversarial m2m-split transactions signed by the payer (seed 1) against the expectation below; every one must be rejected with this exact code and reason. Amounts are strings of base units.",
        expectation: expected(),
        cases: vectors,
      },
      (_k, v) => (typeof v === "bigint" ? `${v}` : v),
      2,
    )}\n`;
    if (process.env.UPDATE_VECTORS || !existsSync(file)) writeFileSync(file, json);
    expect(readFileSync(file, "utf8")).toBe(json);
  });
});
