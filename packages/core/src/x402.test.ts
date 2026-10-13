import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SignedQuote } from "./quote.js";
import {
  decodeHeader,
  encodeHeader,
  M2M_SPLIT,
  type PaymentRequired,
  paymentIdOf,
  paymentRequired,
  quoteFromRequirements,
} from "./x402.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/quote.json", import.meta.url), "utf8"),
);
const quote: SignedQuote = { ...vectors.quote, signature: vectors.signature };

describe("x402 v2 wire format (D21)", () => {
  it("encodes headers as base64 JSON and decodes them back", () => {
    const value = { x402Version: 2, hello: "wörld" };
    const header = encodeHeader(value);
    expect(Buffer.from(header, "base64").toString("utf8")).toBe(JSON.stringify(value));
    expect(decodeHeader(header)).toEqual(value);
  });

  it("rejects malformed headers", () => {
    expect(() => decodeHeader("%%%")).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});

describe("m2m-split payment requirements (section G, C)", () => {
  const required: PaymentRequired = paymentRequired(quote, {
    url: "https://agent.example/forecast",
    description: "Weather forecast",
    mimeType: "application/json",
  });

  it("offers m2m-split with the section G fields and the signed quote in extra", () => {
    expect(required.x402Version).toBe(2);
    expect(required.resource.url).toBe("https://agent.example/forecast");
    expect(required.accepts).toEqual([
      {
        scheme: M2M_SPLIT,
        network: quote.network,
        amount: "10000000",
        asset: quote.mint,
        payTo: quote.payee,
        maxTimeoutSeconds: 30,
        extra: { ...quote, paymentFlow: "upfront" },
      },
    ]);
  });

  it("requires a payment identifier and carries the referral link (sections C, K)", () => {
    expect(required.extensions?.["payment-identifier"]?.info).toEqual({ required: true });
    expect(required.extensions?.["m2m-referral"]?.info).toEqual({ link: quote.referral });
  });

  it("recovers the signed quote from the requirements", () => {
    expect(quoteFromRequirements(required.accepts[0] as never)).toEqual(quote);
  });

  it("reads the payment identifier from a payment payload", () => {
    expect(
      paymentIdOf({
        extensions: {
          "payment-identifier": { info: { required: true, id: "pay_1234567890abcdef" } },
        },
      }),
    ).toBe("pay_1234567890abcdef");
    expect(paymentIdOf({})).toBeUndefined();
  });
});
