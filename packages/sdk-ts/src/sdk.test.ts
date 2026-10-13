import {
  associatedTokenAccount,
  DEVNET,
  MAX_COMPUTE_UNIT_PRICE,
  NETWORKS,
  type Quote,
  type SignedQuote,
  signQuote,
  splitExpectation,
  verifySplitTransaction,
} from "@m2m-monster/core";
import { type MockRpcState, mockRpc, putTokenAccount } from "@m2m-monster/core/testing";
import {
  type Address,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressFromPublicKey,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPayment } from "./payee.js";
import { payQuote } from "./payer.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;
const NOW = 1_791_460_000_000;

let payer: KeyPairSigner;
let payee: KeyPairSigner;
let serviceKeys: CryptoKeyPair;
let serviceAddress: string;
let quote: SignedQuote;
let rpc: ReturnType<typeof mockRpc>["rpc"];
let state: MockRpcState;

const seed = (n: number) => new Uint8Array(32).fill(n);

async function sign(q: Quote): Promise<SignedQuote> {
  return { ...q, signature: await signQuote(q, serviceKeys.privateKey) };
}

beforeEach(async () => {
  payer = await createKeyPairSignerFromPrivateKeyBytes(seed(1));
  payee = await createKeyPairSignerFromPrivateKeyBytes(seed(2));
  serviceKeys = await createKeyPairFromPrivateKeyBytes(seed(9));
  serviceAddress = await getAddressFromPublicKey(serviceKeys.publicKey);
  quote = await sign({
    id: "q_test_0001",
    nonce: "00112233445566778899aabbccddeeff",
    network: DEVNET,
    mint: USDC,
    decimals: 6,
    amount: "10000000",
    payee: payee.address,
    payee_amount: "9975000",
    treasury: TREASURY,
    usdc_mint: USDC,
    usdc_decimals: 6,
    fee_gross: "25000",
    discount: "0",
    fee_net: "25000",
    expires_at: NOW / 1000 + 30,
    referral: `https://m2m.monster/.well-known/mcp.json?ref=${payee.address}`,
  });
  ({ rpc, state } = mockRpc());
  putTokenAccount(
    state,
    await associatedTokenAccount(payer.address, USDC),
    payer.address,
    USDC,
    20_000_000n,
  );
  putTokenAccount(
    state,
    await associatedTokenAccount(payee.address, USDC),
    payee.address,
    USDC,
    0n,
  );
  putTokenAccount(state, await associatedTokenAccount(TREASURY, USDC), TREASURY, USDC, 0n);
});

const pay = (overrides: Partial<Parameters<typeof payQuote>[0]> = {}) =>
  payQuote({ rpc, signer: payer, quote, serviceAddress, now: () => NOW, ...overrides });

describe("payQuote (payer, section G step 2 and section K)", () => {
  it("builds, simulates and signs the m2m-split transaction", async () => {
    const { transaction } = await pay();
    const verified = await verifySplitTransaction(transaction, splitExpectation(quote), {
      signed: true,
    });
    expect(verified.payer).toBe(payer.address);
    expect(state.simulated.length).toBeGreaterThanOrEqual(1);
    expect(state.simulated.every((s) => s.config.replaceRecentBlockhash === true)).toBe(true);
    expect(state.sent).toEqual([]);
  });

  it("sets the compute unit limit from simulation plus a margin", async () => {
    state.simulation.unitsConsumed = 10_000n;
    expect((await pay()).computeUnitLimit).toBe(12_000);
  });

  it("uses the network priority fee estimate, capped at 5 lamports/CU (D16)", async () => {
    state.priorityFees = [MAX_COMPUTE_UNIT_PRICE * 3n];
    expect((await pay()).computeUnitPrice).toBe(MAX_COMPUTE_UNIT_PRICE);
    state.priorityFees = [700n];
    expect((await pay()).computeUnitPrice).toBe(700n);
  });

  it("rejects a quote not signed by the service key (QUOTE_INVALID)", async () => {
    await expect(pay({ quote: { ...quote, fee_net: "1" } })).rejects.toThrow(
      expect.objectContaining({ code: "QUOTE_INVALID" }),
    );
  });

  it("rejects an expired quote (QUOTE_EXPIRED)", async () => {
    await expect(pay({ now: () => NOW + 31_000 })).rejects.toThrow(
      expect.objectContaining({ code: "QUOTE_EXPIRED" }),
    );
  });

  it("rejects a quote whose treasury is not the network treasury", async () => {
    const forged = await sign({ ...quote, treasury: payee.address });
    await expect(pay({ quote: forged })).rejects.toThrow(
      expect.objectContaining({ code: "QUOTE_INVALID" }),
    );
  });

  it("rejects a mint outside the whitelist (MINT_NOT_ALLOWED)", async () => {
    const forged = await sign({ ...quote, mint: payee.address });
    await expect(pay({ quote: forged })).rejects.toThrow(
      expect.objectContaining({ code: "MINT_NOT_ALLOWED" }),
    );
  });

  it("refuses when the payee token account is missing (RECEIVER_TOKEN_ACCOUNT_MISSING)", async () => {
    state.accounts.delete(await associatedTokenAccount(payee.address, USDC));
    await expect(pay()).rejects.toThrow(
      expect.objectContaining({ code: "RECEIVER_TOKEN_ACCOUNT_MISSING" }),
    );
  });

  it("refuses when the treasury USDC account is missing (RECEIVER_TOKEN_ACCOUNT_MISSING)", async () => {
    state.accounts.delete(await associatedTokenAccount(TREASURY, USDC));
    await expect(pay()).rejects.toThrow(
      expect.objectContaining({ code: "RECEIVER_TOKEN_ACCOUNT_MISSING" }),
    );
  });

  it("refuses without enough USDC for the fee (FEE_BALANCE_INSUFFICIENT_USDC)", async () => {
    putTokenAccount(
      state,
      await associatedTokenAccount(payer.address, USDC),
      payer.address,
      USDC,
      24_999n,
    );
    await expect(pay()).rejects.toThrow(
      expect.objectContaining({ code: "FEE_BALANCE_INSUFFICIENT_USDC" }),
    );
  });

  it("refuses without a USDC account at all (FEE_BALANCE_INSUFFICIENT_USDC)", async () => {
    state.accounts.delete(await associatedTokenAccount(payer.address, USDC));
    await expect(pay()).rejects.toThrow(
      expect.objectContaining({ code: "FEE_BALANCE_INSUFFICIENT_USDC" }),
    );
  });

  it("does not sign when simulation fails (SIMULATION_FAILED)", async () => {
    state.simulation = {
      err: { InstructionError: [2, { Custom: 1 }] },
      logs: ["insufficient funds"],
    };
    await expect(pay()).rejects.toThrow(expect.objectContaining({ code: "SIMULATION_FAILED" }));
  });
});

describe("verifyPayment (payee, section G step 3)", () => {
  const verify = async (overrides: Partial<Parameters<typeof verifyPayment>[0]> = {}) =>
    verifyPayment({
      rpc,
      quote,
      transaction: (await pay()).transaction,
      serviceAddress,
      now: () => NOW,
      ...overrides,
    });

  it("accepts the payer's signed transaction and simulates it with signature checks", async () => {
    const verified = await verify();
    expect(verified.payer).toBe(payer.address);
    expect(state.simulated.at(-1)?.config).toMatchObject({ sigVerify: true });
  });

  it("rejects a transaction built for another quote", async () => {
    const other = await sign({ ...quote, id: "q_other", payee_amount: "9975001" });
    const transaction = (await pay()).transaction;
    await expect(verify({ quote: other, transaction })).rejects.toThrow(
      expect.objectContaining({ code: "PAYMENT_TRANSACTION_INVALID" }),
    );
  });

  it("rejects an expired quote", async () => {
    const transaction = (await pay()).transaction;
    await expect(verify({ transaction, now: () => NOW + 31_000 })).rejects.toThrow(
      expect.objectContaining({ code: "QUOTE_EXPIRED" }),
    );
  });

  it("rejects a quote not signed by the service key", async () => {
    const transaction = (await pay()).transaction;
    await expect(
      verify({ transaction, quote: { ...quote, signature: quote.signature.slice(1) } }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUOTE_INVALID" }));
  });

  it("rejects when simulation fails", async () => {
    const transaction = (await pay()).transaction;
    state.simulation = { err: "BlockhashNotFound", logs: [] };
    await expect(verify({ transaction })).rejects.toThrow(
      expect.objectContaining({ code: "SIMULATION_FAILED" }),
    );
  });
});
