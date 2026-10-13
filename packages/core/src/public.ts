// Machine-readable pricing (sections B, C, F; D12), generated from the enforced constants so
// what is published always matches what is charged. Only what works today is listed.
import { AGENT_FEE, MIN_PAYMENT, QUOTE_TTL_SECONDS, REFERRAL, USD_UNITS } from "./constants.js";
import { NETWORKS, type Network } from "./networks.js";

/** USDC base units as a decimal dollar string without trailing zeros. */
export function formatUsd(units: bigint): string {
  const whole = units / USD_UNITS;
  const fraction = (units % USD_UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** Basis points as a percent string: 25 bps -> "0.25". */
const percent = (bps: bigint) => formatUsd(bps * 10_000n);

export function pricing(network: Network) {
  const config = NETWORKS[network];
  const min = formatUsd(AGENT_FEE.min);
  const max = formatUsd(AGENT_FEE.max);
  const rate = percent(AGENT_FEE.rateBps);
  return {
    version: 1,
    network: { id: network, name: config.name, tokens: config.mints },
    quote_validity_seconds: QUOTE_TTL_SECONDS,
    agent_to_agent: {
      formula: `fee = min(max(${rate}% × amount, $${min}), $${max})`,
      rate_percent: rate,
      min_fee_usd: min,
      max_fee_usd: max,
      min_payment_usd: formatUsd(MIN_PAYMENT),
      rounding: "Fees are rounded up to the smallest USDC unit (0.000001).",
      borne_by: "payee",
      fee_token: { symbol: "USDC", mint: config.usdc },
    },
    referral_program: {
      referred_discount_percent: Number(REFERRAL.referredDiscountPercent),
      referred_discount_days: REFERRAL.referredDiscountDays,
      referrer_credit_percent: Number(REFERRAL.creditPercent),
      referrer_credit_months: REFERRAL.creditMonths,
      credit_expiry_months: REFERRAL.creditMonths,
      max_combined_discount_percent: Number(REFERRAL.maxCombinedDiscountPercent),
      activation: {
        settlements_as_payee: REFERRAL.activationSettlements,
        volume_usd: formatUsd(REFERRAL.activationVolume),
      },
      credits:
        "Credits are discounts on the referrer's own m2m.monster fees. They are not cash and cannot be withdrawn, exchanged or transferred.",
    },
  };
}
