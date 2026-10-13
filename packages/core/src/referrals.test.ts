import { describe, expect, it } from "vitest";
import {
  activationReached,
  addMonths,
  creditAccrualOpen,
  creditExpiry,
  referredDiscountActive,
  registrationMessage,
  usdUnits,
} from "./referrals.js";

const day = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-10-09T12:00:00Z");

describe("referred discount: 90 days from the first settlement (section C, D5)", () => {
  it("applies before the first settlement", () => {
    expect(referredDiscountActive(null, t0)).toBe(true);
  });

  it("applies during the 90 days and ends after them", () => {
    expect(referredDiscountActive(t0, new Date(t0.getTime() + 90 * day - 1))).toBe(true);
    expect(referredDiscountActive(t0, new Date(t0.getTime() + 90 * day))).toBe(false);
  });
});

describe("activation: 20 settlements or $10 of settled volume (section C)", () => {
  it.each([
    [19, 9_999_999n, false],
    [20, 0n, true],
    [0, 10_000_000n, true],
    [1, 9_999_999n, false],
  ])("%i settlements, %s volume -> %s", (settlements, volume, expected) => {
    expect(activationReached(settlements, volume)).toBe(expected);
  });
});

describe("credits: 12-month accrual window and 12-month expiry (section C, D5)", () => {
  it("accrues only after activation and for 12 months", () => {
    expect(creditAccrualOpen(null, t0)).toBe(false);
    expect(creditAccrualOpen(t0, t0)).toBe(true);
    expect(creditAccrualOpen(t0, new Date("2027-10-09T11:59:59Z"))).toBe(true);
    expect(creditAccrualOpen(t0, new Date("2027-10-09T12:00:00Z"))).toBe(false);
  });

  it("expires 12 months after accrual", () => {
    expect(creditExpiry(t0)).toEqual(new Date("2027-10-09T12:00:00Z"));
  });

  it("adds calendar months, clamping to the end of shorter months", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1)).toEqual(
      new Date("2026-02-28T00:00:00Z"),
    );
    expect(addMonths(new Date("2028-02-29T00:00:00Z"), 12)).toEqual(
      new Date("2029-02-28T00:00:00Z"),
    );
  });
});

describe("usdUnits", () => {
  it("values 1-USD tokens in USDC base units using on-chain decimals", () => {
    expect(usdUnits(10_000_000n, 6)).toBe(10_000_000n);
    expect(usdUnits(10_000_000_000n, 9)).toBe(10_000_000n);
    expect(usdUnits(1_999n, 9)).toBe(1n);
  });
});

describe("registration challenge (section D)", () => {
  it("binds the nonce to the public key", () => {
    expect(registrationMessage("9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu", "abc")).toBe(
      "m2m.monster registration\npubkey: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu\nnonce: abc",
    );
  });
});
