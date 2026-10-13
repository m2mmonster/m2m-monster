import { readFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import type { Quote } from "./quote.js";
import {
  didKey,
  type Receipt,
  receiptFromQuote,
  signReceipt,
  verifyReceiptSignature,
} from "./receipt.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/quote.json", import.meta.url), "utf8"),
);
const quote: Quote = vectors.quote;
const SIGNATURE =
  "5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7";

let keys: CryptoKeyPair;
let service: string;
let receipt: Receipt;

beforeAll(async () => {
  keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9));
  service = await getAddressFromPublicKey(keys.publicKey);
  receipt = receiptFromQuote(quote, {
    payer: "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
    transaction: SIGNATURE,
    issuedAt: 1_791_460_010,
  });
});

describe("receipts (sections 0, C, G; D14)", () => {
  it("carries the fee breakdown and links to the on-chain signature", () => {
    expect(receipt).toEqual({
      version: 1,
      id: quote.id,
      network: quote.network,
      transaction: SIGNATURE,
      payer: "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
      payee: quote.payee,
      mint: quote.mint,
      decimals: 6,
      amount: "10000000",
      payee_amount: "9975000",
      usdc_mint: quote.usdc_mint,
      usdc_decimals: 6,
      treasury: quote.treasury,
      fee_gross: "25000",
      discount: "0",
      fee_net: "25000",
      issued_at: 1_791_460_010,
      referral: quote.referral,
    });
  });

  it("encodes the service key as did:key", async () => {
    expect(didKey(service)).toMatch(/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("signs as a compact JWS with EdDSA and verifies", async () => {
    const jws = await signReceipt(receipt, keys.privateKey, service);
    const [header] = jws.split(".");
    expect(JSON.parse(Buffer.from(header as string, "base64url").toString())).toEqual({
      alg: "EdDSA",
      typ: "JWT",
      kid: `${didKey(service)}#${didKey(service).slice(8)}`,
    });
    expect(await verifyReceiptSignature(jws, service)).toEqual(receipt);
  });

  it("rejects a tampered payload", async () => {
    const jws = await signReceipt(receipt, keys.privateKey, service);
    const [h, , s] = jws.split(".");
    const forged = Buffer.from(JSON.stringify({ ...receipt, fee_net: "1" })).toString("base64url");
    await expect(verifyReceiptSignature(`${h}.${forged}.${s}`, service)).rejects.toThrow(
      expect.objectContaining({ code: "RECEIPT_INVALID" }),
    );
  });

  it("rejects another signer and malformed input", async () => {
    const jws = await signReceipt(receipt, keys.privateKey, service);
    await expect(verifyReceiptSignature(jws, receipt.payee)).rejects.toThrow(
      expect.objectContaining({ code: "RECEIPT_INVALID" }),
    );
    await expect(verifyReceiptSignature("a.b", service)).rejects.toThrow(
      expect.objectContaining({ code: "RECEIPT_INVALID" }),
    );
  });
});
