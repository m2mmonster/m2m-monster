// Shared layout vectors (spec/test-vectors/split.json). Regenerate with UPDATE_VECTORS=1 after
// a deliberate layout change; otherwise this test fails on any byte difference.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Address, blockhash, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { expect, it } from "vitest";
import { MAINNET, NETWORKS } from "./networks.js";
import {
  buildSplitTransaction,
  type SplitParams,
  signSplitTransaction,
  verifySplitTransaction,
} from "./split.js";

const FILE = new URL("../../../spec/test-vectors/split.json", import.meta.url);
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" as Address;

const signer = (seed: number) =>
  createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));

it("matches spec/test-vectors/split.json", async () => {
  const [payer, payee, treasury] = await Promise.all([signer(1), signer(2), signer(3)]);
  const base = {
    network: MAINNET,
    payer: payer.address,
    payee: payee.address,
    treasury: treasury.address,
    paymentMint: NETWORKS[MAINNET].usdc as Address,
    paymentDecimals: 6,
    usdcDecimals: 6,
    payeeAmount: 9_975_000n,
    feeNet: 25_000n,
    receiptId: "q_test_0001",
    computeUnitLimit: 20_000,
    computeUnitPrice: 1_000n,
    lifetime: {
      blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"),
      lastValidBlockHeight: 291470237n,
    },
  } satisfies SplitParams;

  const cases: [string, SplitParams][] = [
    ["$10 in USDC, no discount", base],
    ["$10 in USDT, fee in USDC", { ...base, paymentMint: USDT }],
    ["$10 in USDC, referred discount", { ...base, payeeAmount: 9_981_250n, feeNet: 18_750n }],
    ["$0.001 minimum payment", { ...base, payeeAmount: 0n, feeNet: 1_000n, computeUnitPrice: 0n }],
  ];

  const valid = [];
  for (const [name, p] of cases) {
    const unsigned = await buildSplitTransaction(p);
    const signed = await signSplitTransaction(unsigned, payer.keyPair);
    await verifySplitTransaction(signed, p, { signed: true });
    valid.push({
      name,
      params: p,
      unsigned,
      signed,
    });
  }

  const mismatches: [string, Record<string, string | number>, string][] = [
    [
      "net amount to the payee",
      { payeeAmount: "9975001" },
      "instruction 2: amount does not match the quote",
    ],
    ["fee to the treasury", { feeNet: "24999" }, "instruction 3: amount does not match the quote"],
    [
      "payee",
      { payee: "11111111111111111111111111111111" },
      "instruction 2: destination does not match the quote",
    ],
    [
      "treasury",
      { treasury: "11111111111111111111111111111111" },
      "instruction 3: destination does not match the quote",
    ],
    ["payment mint", { paymentMint: USDT }, "instruction 2: mint does not match the quote"],
    ["receipt id", { receiptId: "q_other" }, "instruction 4: memo does not match the quote"],
  ];
  const invalid = mismatches.map(([name, change, reason]) => ({
    name,
    transaction: valid[0]?.signed,
    expectation_change: change,
    code: "PAYMENT_TRANSACTION_INVALID",
    reason,
  }));

  const vectors = {
    description:
      "m2m-split layout (section G). Keys are 32-byte private keys filled with the seed byte: payer 1, payee 2, treasury 3. Amounts are strings of base units. Transactions are base64 wire bytes. Invalid cases verify `transaction` against the first valid case's params with `expectation_change` applied.",
    seeds: { payer: 1, payee: 2, treasury: 3 },
    valid,
    invalid,
  };
  const json = `${JSON.stringify(vectors, (_k, v) => (typeof v === "bigint" ? `${v}` : v), 2)}\n`;

  if (process.env.UPDATE_VECTORS || !existsSync(FILE)) writeFileSync(FILE, json);
  expect(readFileSync(FILE, "utf8")).toBe(json);

  for (const v of invalid) {
    const p = { ...base, ...v.expectation_change } as Record<string, unknown>;
    for (const k of ["payeeAmount", "feeNet"]) p[k] = BigInt(p[k] as string | bigint);
    await expect(
      verifySplitTransaction(v.transaction as string, p as unknown as SplitParams, {
        signed: true,
      }),
    ).rejects.toThrow(v.reason);
  }
});
