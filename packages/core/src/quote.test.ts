import { readFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVNET, NETWORKS } from "./networks.js";
import {
  assertQuoteFresh,
  assertQuoteValid,
  priceSplit,
  type Quote,
  quoteMessage,
  signQuote,
  splitExpectation,
  verifyQuote,
} from "./quote.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/quote.json", import.meta.url), "utf8"),
);
const quote: Quote = vectors.quote;

let keys: CryptoKeyPair;
let service: string;
beforeAll(async () => {
  keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(vectors.service_seed));
  service = await getAddressFromPublicKey(keys.publicKey);
});

describe("priceSplit (sections C, F; D1)", () => {
  it("$10 in USDC, no discount: payee gets amount − fee", () => {
    expect(priceSplit({ amount: 10_000_000n, decimals: 6, referred: false, credits: 0n })).toEqual({
      feeGross: 25_000n,
      discount: 0n,
      creditsUsed: 0n,
      feeNet: 25_000n,
      payeeAmount: 9_975_000n,
    });
  });

  it("the discount goes to the payee: payee gets amount − fee_net", () => {
    expect(
      priceSplit({ amount: 10_000_000n, decimals: 6, referred: true, credits: 0n }),
    ).toMatchObject({
      feeNet: 18_750n,
      payeeAmount: 9_981_250n,
    });
  });

  it("$0.001 payment: the whole amount is the fee", () => {
    expect(
      priceSplit({ amount: 1_000n, decimals: 6, referred: false, credits: 0n }).payeeAmount,
    ).toBe(0n);
  });

  it("rejects payments below the minimum", () => {
    expect(() => priceSplit({ amount: 999n, decimals: 6, referred: false, credits: 0n })).toThrow(
      expect.objectContaining({ code: "PAYMENT_BELOW_MINIMUM" }),
    );
  });
});

describe("signed quotes (D7)", () => {
  it("serializes with sorted keys and no whitespace", () => {
    expect(quoteMessage(quote)).toBe(vectors.message);
  });

  it("produces the vector signature from the vector key", async () => {
    expect(service).toBe(vectors.service_address);
    expect(await signQuote(quote, keys.privateKey)).toBe(vectors.signature);
  });

  it("verifies its own signature", async () => {
    expect(await verifyQuote({ ...quote, signature: vectors.signature }, service)).toBe(true);
  });

  it("rejects a tampered quote", async () => {
    expect(
      await verifyQuote({ ...quote, fee_net: "1", signature: vectors.signature }, service),
    ).toBe(false);
  });

  it("rejects a signature from another key or a malformed one", async () => {
    expect(await verifyQuote({ ...quote, signature: vectors.signature }, quote.payee)).toBe(false);
    expect(await verifyQuote({ ...quote, signature: "garbage" }, service)).toBe(false);
  });

  it("expires after expires_at (section K)", () => {
    expect(() => assertQuoteFresh(quote, quote.expires_at)).not.toThrow();
    expect(() => assertQuoteFresh(quote, quote.expires_at + 1)).toThrow(
      expect.objectContaining({ code: "QUOTE_EXPIRED" }),
    );
  });

  it("maps to the transaction expectation", () => {
    expect(splitExpectation(quote)).toEqual({
      network: DEVNET,
      payee: quote.payee,
      treasury: quote.treasury,
      paymentMint: quote.mint,
      paymentDecimals: 6,
      usdcDecimals: 6,
      payeeAmount: 9_975_000n,
      feeNet: 25_000n,
      receiptId: quote.id,
    });
  });
});

describe("assertQuoteValid", () => {
  const base: Quote = { ...quote, treasury: NETWORKS[DEVNET].treasury as string };
  const now = base.expires_at - 10;
  const signed = async (q: Quote) => ({ ...q, signature: await signQuote(q, keys.privateKey) });

  it("accepts a valid quote", async () => {
    await expect(assertQuoteValid(await signed(base), service, now)).resolves.toBeUndefined();
  });

  it.each([
    ["a bad signature", async () => ({ ...(await signed(base)), fee_net: "1" }), "QUOTE_INVALID"],
    ["another treasury", () => signed({ ...base, treasury: base.payee }), "QUOTE_INVALID"],
    ["another USDC mint", () => signed({ ...base, usdc_mint: base.payee }), "QUOTE_INVALID"],
    [
      "an unknown network",
      () => signed({ ...base, network: "solana:x" as Quote["network"] }),
      "QUOTE_INVALID",
    ],
    [
      "a mint outside the whitelist",
      () => signed({ ...base, mint: base.payee }),
      "MINT_NOT_ALLOWED",
    ],
  ])("rejects %s", async (_name, make, code) => {
    await expect(assertQuoteValid(await make(), service, now)).rejects.toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("rejects an expired quote", async () => {
    await expect(
      assertQuoteValid(await signed(base), service, base.expires_at + 1),
    ).rejects.toThrow(expect.objectContaining({ code: "QUOTE_EXPIRED" }));
  });
});
