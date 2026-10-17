// End-to-end payments on Solana Devnet: API quote -> payer SDK -> payee SDK -> on-chain.
// Requires the test wallets in .env and a funded payer (SOL for gas, Circle Devnet USDC).
// Tests never use real funds (rule 11).
import {
  type AllowedMint,
  associatedTokenAccount,
  DEVNET,
  encodeHeader,
  M2mError,
  MEMO_PREFIX,
  mintDecimals,
  NETWORKS,
  type SolanaRpc,
  signSplitTransaction,
  submitAndConfirm,
  tokenBalance,
} from "@m2m-monster/core";
import {
  createApiClient,
  createPaymentFetch,
  createPaywall,
  paymentOutcome,
  payQuote,
  settlementOf,
  submitPayment,
  verifyPayment,
} from "@m2m-monster/sdk";
import {
  type Address,
  appendTransactionMessageInstructions,
  createDefaultRpcTransport,
  createKeyPairFromBytes,
  createKeyPairSignerFromBytes,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  fetchMaybeMint,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DEMO_PAYEE } from "./demo.js";
import { memoryKv } from "./kv.js";
import { testDb } from "./test-db.js";

process.loadEnvFile(new URL("../../../.env", import.meta.url));

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
};
const secret = (name: string) => getBase58Encoder().encode(env(name));

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;
const MIN_SOL = 50_000_000n;
const MIN_USDC = 1_000_000n;

let rpc: SolanaRpc;
let payer: KeyPairSigner;
let payee: KeyPairSigner;
let testMint: KeyPairSigner;
let api: ReturnType<typeof createApiClient>;
let serviceAddress: string;
let app: ReturnType<typeof createApp>;

async function send(instructions: Instruction[]) {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  return submitAndConfirm(rpc, getBase64EncodedWireTransaction(signed), {
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  });
}

/** Creates the token accounts and the test "USDT" mint once. Setup only, never a payment. */
async function ensureSetup() {
  const sol = (await rpc.getBalance(payer.address, { commitment: "confirmed" }).send()).value;
  const usdc = (await tokenBalance(rpc, payer.address, USDC)) ?? 0n;
  if (sol < MIN_SOL || usdc < MIN_USDC) {
    throw new Error(
      `Fund the Devnet payer ${payer.address}: needs >= 0.05 SOL (has ${sol} lamports) and >= 1 Devnet USDC (has ${usdc} base units).`,
    );
  }

  if (!(await fetchMaybeMint(rpc, testMint.address)).exists) {
    const space = BigInt(getMintSize());
    const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
    await send([
      getCreateAccountInstruction({
        payer,
        newAccount: testMint,
        lamports: rent,
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: testMint.address,
        decimals: 6,
        mintAuthority: testMint.address,
      }),
    ]);
  }

  const accounts: [Address, Address][] = [
    [payee.address, USDC],
    [TREASURY, USDC],
    [payer.address, testMint.address],
    [payee.address, testMint.address],
  ];
  const missing = [];
  for (const [owner, mint] of accounts) {
    if ((await tokenBalance(rpc, owner, mint)) === undefined) missing.push([owner, mint] as const);
  }
  if (missing.length) {
    await send(
      await Promise.all(
        missing.map(([owner, mint]) =>
          getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner, mint }),
        ),
      ),
    );
  }

  // The payee pays the gas of its own refunds (rule 3).
  const payeeSol = (await rpc.getBalance(payee.address, { commitment: "confirmed" }).send()).value;
  if (payeeSol < 5_000_000n) {
    await send([
      getTransferSolInstruction({ source: payer, destination: payee.address, amount: 10_000_000n }),
    ]);
  }

  if (((await tokenBalance(rpc, payer.address, testMint.address)) ?? 0n) < 10_000_000n) {
    await send([
      getMintToCheckedInstruction({
        mint: testMint.address,
        token: await associatedTokenAccount(payer.address, testMint.address),
        mintAuthority: testMint,
        amount: 1_000_000_000n,
        decimals: 6,
      }),
    ]);
  }
}

beforeAll(async () => {
  // The public Devnet RPC rate-limits bursts (HTTP 429); retry with backoff in tests.
  const transport = createDefaultRpcTransport({ url: env("SOLANA_RPC_URL") });
  rpc = createSolanaRpcFromTransport((async (request: Parameters<typeof transport>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transport(request);
      } catch (error) {
        if (attempt >= 8 || !String(error).includes("429")) throw error;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }) as typeof transport);
  payer = await createKeyPairSignerFromBytes(secret("DEVNET_PAYER_KEY"));
  payee = await createKeyPairSignerFromBytes(secret("DEVNET_PAYEE_KEY"));
  testMint = await createKeyPairSignerFromBytes(secret("DEVNET_TEST_MINT_KEY"));

  // Decision D9: the test "USDT" mint is whitelisted only inside this test process.
  (NETWORKS[DEVNET].mints as AllowedMint[]).push({ symbol: "USDT", mint: testMint.address });

  const serviceKeys = await createKeyPairFromBytes(secret("SERVICE_KEY"));
  serviceAddress = await getAddressFromPublicKey(serviceKeys.publicKey);
  app = createApp({
    network: DEVNET,
    treasury: TREASURY,
    serviceKeys,
    serviceAddress,
    kv: memoryKv(),
    db: await testDb(),
    rpc,
    mintDecimals: (mint) => mintDecimals(rpc, mint as Address),
    now: Date.now,
    publicBaseUrl: "https://m2m.monster",
    clientIp: () => "127.0.0.1",
    limits: { ip: 1000, pubkey: 1000, apiKey: 1000 },
  });
  api = createApiClient("http://api.test", { fetch: (request) => app.fetch(request) });

  await ensureSetup();
});

const balances = async (mint: Address) => ({
  payer: (await tokenBalance(rpc, payer.address, mint)) ?? 0n,
  payee: (await tokenBalance(rpc, payee.address, mint)) ?? 0n,
  treasury: (await tokenBalance(rpc, TREASURY, mint)) ?? 0n,
});

const key = () => `devnet-${crypto.randomUUID()}`;

async function payAndSettle(mint: Address, amount: string) {
  const quote = await api.requestQuote(
    { network: DEVNET, mint, amount, payee: payee.address },
    key(),
  );
  expect(quote.signature).toBeTruthy();
  const { transaction } = await payQuote({ rpc, signer: payer, quote, serviceAddress });
  const verified = await verifyPayment({ rpc, quote, transaction, serviceAddress });
  expect(verified.payer).toBe(payer.address);
  const signature = await submitPayment({ rpc, transaction });
  return { quote, signature };
}

describe("m2m-split on Devnet (sections G, K)", () => {
  it("settles a USDC payment: net to the payee, fee_net to the treasury, memo on-chain", async () => {
    const before = await balances(USDC);
    const { quote, signature } = await payAndSettle(USDC, "100000");
    expect(quote).toMatchObject({ fee_gross: "1000", fee_net: "1000", payee_amount: "99000" });

    const after = await balances(USDC);
    expect(after.payee - before.payee).toBe(99_000n);
    expect(after.treasury - before.treasury).toBe(1_000n);
    expect(before.payer - after.payer).toBe(100_000n);

    const tx = await rpc
      .getTransaction(signature as never, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
        encoding: "json",
      })
      .send();
    expect(tx?.meta?.err).toBeNull();
    expect(tx?.meta?.logMessages?.join("\n")).toContain(`${MEMO_PREFIX} ${quote.id}`);
    expect(tx?.transaction.message.accountKeys[0]).toBe(payer.address);

    // The payee broadcast it itself; it reports the signature to get a receipt (D8).
    const settled = await api.reportPayment(quote, signature);
    expect(settled.receipt_data).toMatchObject({
      id: quote.id,
      transaction: signature,
      fee_net: "1000",
    });
    const checked = await api.verifyReceipt(settled.receipt);
    expect(checked.receipt_data.payer).toBe(payer.address);
  });

  it("settles through the relay and returns a receipt verifiable on-chain (section L)", async () => {
    const before = await balances(USDC);
    const quote = await api.requestQuote(
      { network: DEVNET, mint: USDC, amount: "200000", payee: payee.address },
      key(),
    );
    const { transaction } = await payQuote({ rpc, signer: payer, quote, serviceAddress });
    const idempotencyKey = key();
    const settled = await api.relayPayment(quote, transaction, idempotencyKey);
    expect(settled.receipt_data).toMatchObject({
      id: quote.id,
      payer: payer.address,
      payee: payee.address,
      fee_gross: "1000",
      discount: "0",
      fee_net: "1000",
      payee_amount: "199000",
    });

    const after = await balances(USDC);
    expect(after.payee - before.payee).toBe(199_000n);
    expect(after.treasury - before.treasury).toBe(1_000n);

    // A retry with the same key returns the same settlement and never pays twice.
    expect(settled.replayed).toBe(false);
    expect(await api.relayPayment(quote, transaction, idempotencyKey)).toEqual({
      ...settled,
      replayed: true,
    });
    expect((await balances(USDC)).payee).toBe(after.payee);

    const checked = await api.verifyReceipt(settled.receipt);
    expect(BigInt(checked.slot)).toBeGreaterThan(0n);
    const { replayed: _replayed, ...stored } = settled;
    expect(await api.getReceipt(quote.id)).toEqual(stored);
  });

  it("settles a test-USDT payment with the fee in USDC", async () => {
    const usdcBefore = await balances(USDC);
    const tokenBefore = await balances(testMint.address);
    const { quote } = await payAndSettle(testMint.address, "1000000");
    expect(quote).toMatchObject({ fee_net: "2500", payee_amount: "997500", usdc_mint: USDC });

    const usdcAfter = await balances(USDC);
    const tokenAfter = await balances(testMint.address);
    expect(tokenAfter.payee - tokenBefore.payee).toBe(997_500n);
    expect(tokenBefore.payer - tokenAfter.payer).toBe(997_500n);
    expect(usdcAfter.treasury - usdcBefore.treasury).toBe(2_500n);
    expect(usdcBefore.payer - usdcAfter.payer).toBe(2_500n);
    expect(tokenAfter.treasury).toBe(0n);
  });

  it("x402 v2: request, 402 with m2m-split, pay, 200 with PAYMENT-RESPONSE (section G)", async () => {
    const before = await balances(USDC);
    const paywall = createPaywall({ api, rpc, network: DEVNET, payee: payee.address });
    const resource = (request: Request) =>
      paywall.handle(
        request,
        { mint: USDC, amount: "50000" },
        { description: "Devnet test" },
        async () => Response.json({ paid: true }),
      );
    const paidFetch = createPaymentFetch({ rpc, signer: payer, serviceAddress, fetch: resource });

    expect((await resource(new Request("https://agent.test/resource"))).status).toBe(402);
    const res = await paidFetch("https://agent.test/resource");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paid: true });

    const settlement = settlementOf(res);
    expect(settlement).toMatchObject({ success: true, network: DEVNET, payer: payer.address });
    const receipt = settlement?.extensions?.["m2m-receipt"]?.info.receipt as string;
    expect((await api.verifyReceipt(receipt)).receipt_data).toMatchObject({
      fee_net: "1000",
      payee_amount: "49000",
    });

    const after = await balances(USDC);
    expect(after.payee - before.payee).toBe(49_000n);
    expect(after.treasury - before.treasury).toBe(1_000n);
  });

  it("pays, loses the response, retries: one payment on Devnet (D66)", async () => {
    const before = await balances(USDC);
    const paywall = createPaywall({ api, rpc, network: DEVNET, payee: payee.address });
    const resource = (request: Request) =>
      paywall.handle(request, { mint: USDC, amount: "20000" }, {}, async () =>
        Response.json({ paid: true }),
      );
    const headers: string[] = [];
    let paidAttempts = 0;
    const pay = createPaymentFetch({
      rpc,
      signer: payer,
      serviceAddress,
      fetch: async (request) => {
        const header = request.headers.get("PAYMENT-SIGNATURE");
        if (!header) return resource(request);
        headers.push(header);
        paidAttempts++;
        if (paidAttempts === 1) {
          await resource(request); // settles on-chain, then the response is lost
          throw new TypeError("network error: response lost");
        }
        if (paidAttempts === 2) {
          // A seller answer without a receipt: the SDK must decide from the real chain.
          return new Response("{}", {
            status: 402,
            headers: {
              "PAYMENT-RESPONSE": encodeHeader({
                success: false,
                errorReason: "QUOTE_EXPIRED",
                transaction: "",
                network: DEVNET,
              }),
            },
          });
        }
        return resource(request);
      },
    });

    await expect(pay("https://agent.test/retry")).rejects.toThrow("response lost");
    const viaChain = await pay("https://agent.test/retry");
    expect(paymentOutcome(viaChain)).toMatchObject({ status: "already_paid" });
    expect(paymentOutcome(viaChain)?.receipt).toBeUndefined();
    expect(headers[1]).toBe(headers[0]);

    const after = await balances(USDC);
    expect(after.payee - before.payee).toBe(19_000n); // exactly one payment
    expect(after.treasury - before.treasury).toBe(1_000n);
  });

  it("refunds from the payee to the payer with no fee (build_refund, section K)", async () => {
    const quote = await api.requestQuote(
      { network: DEVNET, mint: USDC, amount: "100000", payee: payee.address },
      key(),
    );
    const { transaction } = await payQuote({ rpc, signer: payer, quote, serviceAddress });
    const settled = await api.relayPayment(quote, transaction, key());

    const before = await balances(USDC);
    const refund = await api.buildRefund(settled.receipt, "99000");
    const signed = await signSplitTransaction(refund.transaction, payee.keyPair);
    await submitAndConfirm(rpc, signed);
    const after = await balances(USDC);
    expect(after.payer - before.payer).toBe(99_000n);
    expect(before.payee - after.payee).toBe(99_000n);
    expect(after.treasury).toBe(before.treasury);
  });

  it("pays the Devnet demo resource: GET /demo -> 402 -> pay -> 200 (D48)", async () => {
    const demoBefore = (await tokenBalance(rpc, DEMO_PAYEE as Address, USDC)) ?? 0n;
    const treasuryBefore = (await tokenBalance(rpc, TREASURY, USDC)) ?? 0n;
    const pay = createPaymentFetch({
      rpc,
      signer: payer,
      serviceAddress,
      fetch: (request) => Promise.resolve(app.fetch(request)),
    });
    const res = await pay("https://sandbox.m2m.monster/demo");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ demo: true, network: DEVNET });
    expect(settlementOf(res)).toMatchObject({ success: true, payer: payer.address });
    expect(((await tokenBalance(rpc, DEMO_PAYEE as Address, USDC)) ?? 0n) - demoBefore).toBe(
      9_000n,
    );
    expect(((await tokenBalance(rpc, TREASURY, USDC)) ?? 0n) - treasuryBefore).toBe(1_000n);
  });

  it("refuses to pay without USDC for the fee (FEE_BALANCE_INSUFFICIENT_USDC)", async () => {
    const broke = await generateKeyPairSigner();
    const quote = await api.requestQuote(
      { network: DEVNET, mint: testMint.address, amount: "1000000", payee: payee.address },
      key(),
    );
    await expect(payQuote({ rpc, signer: broke, quote, serviceAddress })).rejects.toThrow(
      expect.objectContaining({ code: "FEE_BALANCE_INSUFFICIENT_USDC" }),
    );
  });

  it("refuses to pay a payee without a token account (RECEIVER_TOKEN_ACCOUNT_MISSING)", async () => {
    const stranger = await generateKeyPairSigner();
    const quote = await api.requestQuote(
      { network: DEVNET, mint: USDC, amount: "100000", payee: stranger.address },
      key(),
    );
    await expect(payQuote({ rpc, signer: payer, quote, serviceAddress })).rejects.toThrow(
      expect.objectContaining({ code: "RECEIVER_TOKEN_ACCOUNT_MISSING" }),
    );
  });

  it("does not sign a payment the payer cannot cover (SIMULATION_FAILED)", async () => {
    const quote = await api.requestQuote(
      { network: DEVNET, mint: testMint.address, amount: "1000000000000000", payee: payee.address },
      key(),
    );
    const error = await payQuote({ rpc, signer: payer, quote, serviceAddress }).catch((e) => e);
    expect(error).toBeInstanceOf(M2mError);
    expect(error.code).toBe("SIMULATION_FAILED");
  });

  it("rejects a mint outside the Devnet whitelist (MINT_NOT_ALLOWED)", async () => {
    await expect(
      api.requestQuote(
        {
          network: DEVNET,
          mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
          amount: "1000000",
          payee: payee.address,
        },
        key(),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "MINT_NOT_ALLOWED" }));
  });
});
