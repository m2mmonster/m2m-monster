// Startup checks against the chain. The API refuses to start if one fails (fail closed).
import { NETWORKS, type Network, USD_UNITS } from "@m2m-monster/core";

/** Decimals of the fee unit: fees are computed in 0.000001 USDC (section F, D22). */
export const FEE_UNIT_DECIMALS = USD_UNITS.toString().length - 1;

/** USDC decimals read on-chain must equal the fee unit (section E: never hard-coded). */
export async function checkUsdcDecimals(
  network: Network,
  mintDecimals: (mint: string) => Promise<number>,
): Promise<void> {
  const decimals = await mintDecimals(NETWORKS[network].usdc);
  if (decimals !== FEE_UNIT_DECIMALS) {
    throw new Error(
      `USDC mint has ${decimals} decimals on-chain; the fee unit needs ${FEE_UNIT_DECIMALS}`,
    );
  }
}
