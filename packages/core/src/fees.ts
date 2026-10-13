import { AGENT_FEE, MIN_PAYMENT, REFERRAL, USD_UNITS } from "./constants.js";
import { M2mError } from "./errors.js";

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const pow10 = (decimals: number) => 10n ** BigInt(decimals);

/**
 * Agent-to-agent fee in USDC base units for `amount` base units of a token
 * worth 1 USD with `decimals` decimals (sections E, F). Rounded up.
 */
export function agentFee(amount: bigint, decimals: number): bigint {
  const scale = pow10(decimals);
  if (amount * USD_UNITS < MIN_PAYMENT * scale) throw new M2mError("PAYMENT_BELOW_MINIMUM");
  const fee = ceilDiv(amount * USD_UNITS * AGENT_FEE.rateBps, 10_000n * scale);
  if (fee < AGENT_FEE.min) return AGENT_FEE.min;
  if (fee > AGENT_FEE.max) return AGENT_FEE.max;
  return fee;
}

export interface FeeBreakdown {
  feeGross: bigint;
  discount: bigint;
  creditsUsed: bigint;
  feeNet: bigint;
}

/**
 * Referred discount first, then credits, never above 50% of the gross fee.
 * Discounts round down (section C, decisions D3 and D6).
 */
export function applyDiscounts(input: {
  feeGross: bigint;
  referred: boolean;
  credits: bigint;
}): FeeBreakdown {
  const { feeGross, referred, credits } = input;
  const cap = (feeGross * REFERRAL.maxCombinedDiscountPercent) / 100n;
  const referredDiscount = referred ? (feeGross * REFERRAL.referredDiscountPercent) / 100n : 0n;
  const room = cap - referredDiscount;
  const creditsUsed = credits < room ? credits : room;
  const discount = referredDiscount + creditsUsed;
  return { feeGross, discount, creditsUsed, feeNet: feeGross - discount };
}

/** Credit earned by the referrer from a fee paid by its referred agent (decision D4). */
export function referralCredit(feeNet: bigint): bigint {
  return (feeNet * REFERRAL.creditPercent) / 100n;
}

/** A fee in USDC base units expressed in base units of a 1-USD token, rounded up. */
export function feeInTokenUnits(feeNet: bigint, decimals: number): bigint {
  return ceilDiv(feeNet * pow10(decimals), USD_UNITS);
}
