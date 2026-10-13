import { describe, expect, it } from "vitest";
import { DEVNET, MAINNET, NETWORKS } from "./networks.js";
import { formatUsd, pricing } from "./public.js";

describe("formatUsd", () => {
  it.each([
    [1_000n, "0.001"],
    [500_000n, "0.5"],
    [10_000_000n, "10"],
    [25_000n, "0.025"],
    [1n, "0.000001"],
  ])("%s -> %s", (units, text) => {
    expect(formatUsd(units)).toBe(text);
  });
});

describe("pricing (sections B, C, F; D12)", () => {
  it("publishes the agent-to-agent tariff from the enforced constants", () => {
    expect(pricing(MAINNET).agent_to_agent).toEqual({
      formula: "fee = min(max(0.25% × amount, $0.001), $0.5)",
      rate_percent: "0.25",
      min_fee_usd: "0.001",
      max_fee_usd: "0.5",
      min_payment_usd: "0.001",
      rounding: "Fees are rounded up to the smallest USDC unit (0.000001).",
      borne_by: "payee",
      fee_token: { symbol: "USDC", mint: NETWORKS[MAINNET].usdc },
    });
  });

  it("publishes the referral program", () => {
    expect(pricing(MAINNET).referral_program).toEqual({
      referred_discount_percent: 25,
      referred_discount_days: 90,
      referrer_credit_percent: 10,
      referrer_credit_months: 12,
      credit_expiry_months: 12,
      max_combined_discount_percent: 50,
      activation: { settlements_as_payee: 20, volume_usd: "10" },
      credits:
        "Credits are discounts on the referrer's own m2m.monster fees. They are not cash and cannot be withdrawn, exchanged or transferred.",
    });
  });

  it("lists the whitelisted tokens of its network only, by exact mint", () => {
    expect(pricing(MAINNET).network).toEqual({
      id: MAINNET,
      name: "solana-mainnet",
      tokens: NETWORKS[MAINNET].mints,
    });
    expect(pricing(DEVNET).network.tokens).toEqual([
      { symbol: "USDC", mint: NETWORKS[DEVNET].usdc },
    ]);
  });

  it("publishes only what works today: no merchant tariff, no other chains", () => {
    const text = JSON.stringify(pricing(MAINNET));
    expect(text).not.toMatch(/merchant|EURC|Base|planned|buy/i);
  });
});
