import { describe, expect, it } from "vitest";
import { allowedMint, DEVNET, MAINNET, NETWORKS } from "./networks.js";

const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAINNET_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("mint whitelist (section E, D9)", () => {
  it("uses CAIP-2 network ids", () => {
    expect(MAINNET).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(DEVNET).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("accepts USDC and USDT on mainnet", () => {
    expect(allowedMint(MAINNET, MAINNET_USDC)).toEqual({ symbol: "USDC", mint: MAINNET_USDC });
    expect(allowedMint(MAINNET, MAINNET_USDT)).toEqual({ symbol: "USDT", mint: MAINNET_USDT });
  });

  it("accepts only Circle USDC on devnet", () => {
    expect(allowedMint(DEVNET, DEVNET_USDC)?.symbol).toBe("USDC");
    expect(NETWORKS[DEVNET].mints).toHaveLength(1);
  });

  it("never mixes mainnet and devnet whitelists", () => {
    expect(allowedMint(DEVNET, MAINNET_USDC)).toBeUndefined();
    expect(allowedMint(DEVNET, MAINNET_USDT)).toBeUndefined();
    expect(allowedMint(MAINNET, DEVNET_USDC)).toBeUndefined();
  });

  it("matches by exact address only", () => {
    expect(allowedMint(MAINNET, MAINNET_USDC.toLowerCase())).toBeUndefined();
    expect(allowedMint(MAINNET, "USDC")).toBeUndefined();
    expect(allowedMint("solana:unknown", MAINNET_USDC)).toBeUndefined();
  });

  it("names the USDC mint used for the fee", () => {
    expect(NETWORKS[MAINNET].usdc).toBe(MAINNET_USDC);
    expect(NETWORKS[DEVNET].usdc).toBe(DEVNET_USDC);
  });
});
