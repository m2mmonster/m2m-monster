import { DEVNET, MAINNET, NETWORKS } from "@m2m-monster/core";
import { describe, expect, it } from "vitest";
import { checkUsdcDecimals, FEE_UNIT_DECIMALS } from "./startup.js";

describe("startup USDC decimals check (sections E, F)", () => {
  it("the fee unit is 0.000001 USDC", () => {
    expect(FEE_UNIT_DECIMALS).toBe(6);
  });

  it("reads the network's exact USDC mint and accepts 6 decimals", async () => {
    const asked: string[] = [];
    for (const network of [DEVNET, MAINNET] as const) {
      await checkUsdcDecimals(network, async (mint) => {
        asked.push(mint);
        return 6;
      });
    }
    expect(asked).toEqual([NETWORKS[DEVNET].usdc, NETWORKS[MAINNET].usdc]);
  });

  it("refuses to start with any other value", async () => {
    for (const decimals of [0, 2, 9]) {
      await expect(checkUsdcDecimals(MAINNET, async () => decimals)).rejects.toThrow(
        `${decimals} decimals`,
      );
    }
  });

  it("refuses to start when the RPC cannot read the mint", async () => {
    await expect(
      checkUsdcDecimals(MAINNET, async () => {
        throw new Error("rpc down");
      }),
    ).rejects.toThrow("rpc down");
  });
});
