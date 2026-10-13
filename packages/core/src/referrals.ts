// Referral program rules (section C; decisions D2–D6) and the registration challenge (section D).
import { REFERRAL, USD_UNITS } from "./constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds calendar months in UTC, clamping to the last day of shorter months. */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** 25% discount for 90 days from the referred agent's first settlement in any role (D5). */
export function referredDiscountActive(firstSettlementAt: Date | null, now: Date): boolean {
  if (!firstSettlementAt) return true;
  return now.getTime() < firstSettlementAt.getTime() + REFERRAL.referredDiscountDays * DAY_MS;
}

/** Credits start accruing once the referred agent has 20 settlements or $10 as payee. */
export function activationReached(settlementsAsPayee: number, volumeAsPayee: bigint): boolean {
  return (
    settlementsAsPayee >= REFERRAL.activationSettlements ||
    volumeAsPayee >= REFERRAL.activationVolume
  );
}

/** The referrer earns credits for 12 months from the referred agent's activation (D5). */
export function creditAccrualOpen(activatedAt: Date | null, now: Date): boolean {
  return !!activatedAt && now < addMonths(activatedAt, REFERRAL.creditMonths);
}

/** Each credit expires 12 months after it accrues (D5). */
export function creditExpiry(accruedAt: Date): Date {
  return addMonths(accruedAt, REFERRAL.creditMonths);
}

/** Value of `amount` base units of a 1-USD token in USDC base units, rounded down. */
export function usdUnits(amount: bigint, decimals: number): bigint {
  return (amount * USD_UNITS) / 10n ** BigInt(decimals);
}

/** The exact text an agent signs with its Solana key to register (section D). */
export function registrationMessage(pubkey: string, nonce: string): string {
  return `m2m.monster registration\npubkey: ${pubkey}\nnonce: ${nonce}`;
}
