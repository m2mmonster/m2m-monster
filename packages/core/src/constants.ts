// Values taken literally from the specification. Do not adjust them.

/** USDC base units per dollar: fees are computed in units of 0.000001 USD (section F). */
export const USD_UNITS = 1_000_000n;

/** Agent-to-agent tariff: min(max(0.25% × amount, $0.001), $0.50) (section F). */
export const AGENT_FEE = {
  rateBps: 25n,
  min: 1_000n,
  max: 500_000n,
} as const;

/** Minimum accepted payment: $0.001 (sections F, K). */
export const MIN_PAYMENT = 1_000n;

/** Referral program (section C). */
export const REFERRAL = {
  referredDiscountPercent: 25n,
  referredDiscountDays: 90,
  creditPercent: 10n,
  creditMonths: 12,
  maxCombinedDiscountPercent: 50n,
  activationSettlements: 20,
  activationVolume: 10_000_000n,
} as const;

/** Quote validity window in seconds (sections F, K). */
export const QUOTE_TTL_SECONDS = 30;
