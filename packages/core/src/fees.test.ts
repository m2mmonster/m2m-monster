import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { M2mError } from "./errors.js";
import { agentFee, applyDiscounts, feeInTokenUnits, referralCredit } from "./fees.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/fees.json", import.meta.url), "utf8"),
);

describe("agentFee (section F)", () => {
  it.each(vectors.fee)("$name", ({ amount, decimals, fee_gross }) => {
    expect(agentFee(BigInt(amount), decimals)).toBe(BigInt(fee_gross));
  });

  it.each(vectors.below_minimum)("rejects $name", ({ amount, decimals }) => {
    expect(() => agentFee(BigInt(amount), decimals)).toThrowError(
      expect.objectContaining({ code: "PAYMENT_BELOW_MINIMUM" }),
    );
    expect(() => agentFee(BigInt(amount), decimals)).toThrow(M2mError);
  });

  it("never decreases when the amount increases", () => {
    let previous = 0n;
    for (let amount = 1_000n; amount <= 1_000_000_000n; amount = (amount * 11n) / 10n + 7n) {
      const fee = agentFee(amount, 6);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });
});

describe("applyDiscounts (section C, D3, D6)", () => {
  it.each(vectors.discount)("$name", (v) => {
    const result = applyDiscounts({
      feeGross: BigInt(v.fee_gross),
      referred: v.referred,
      credits: BigInt(v.credits),
    });
    expect(result).toEqual({
      feeGross: BigInt(v.fee_gross),
      discount: BigInt(v.discount),
      creditsUsed: BigInt(v.credits_used),
      feeNet: BigInt(v.fee_net),
    });
    expect(result.feeNet * 2n).toBeGreaterThanOrEqual(result.feeGross);
  });
});

describe("referralCredit (section C, D4)", () => {
  it.each(vectors.credit)("$name", ({ fee_net, credit }) => {
    expect(referralCredit(BigInt(fee_net))).toBe(BigInt(credit));
  });
});

describe("feeInTokenUnits", () => {
  it.each(vectors.fee_in_token)("$name", ({ fee_net, decimals, fee_token }) => {
    expect(feeInTokenUnits(BigInt(fee_net), decimals)).toBe(BigInt(fee_token));
  });
});
