import { associatedTokenAccount, MAINNET, NETWORKS } from "@m2m-monster/core";
import { mockRpc, putMint, putTokenAccount } from "@m2m-monster/core/testing";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { checkTreasury } from "./treasury-check.js";

const TREASURY = address("9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu");
const USDC = address(NETWORKS[MAINNET].usdc);
const USDT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const failed = (results: { check: string; ok: boolean }[]) =>
  results.filter((r) => !r.ok).map((r) => r.check);

describe("treasury check (read-only, D58)", () => {
  it("passes for a normal wallet with its USDC account and 6-decimal USDC", async () => {
    const { rpc, state } = mockRpc();
    putMint(state, USDC, 6);
    putTokenAccount(state, await associatedTokenAccount(TREASURY, USDC), TREASURY, USDC, 0n);
    const results = await checkTreasury(rpc, MAINNET, TREASURY);
    expect(failed(results)).toEqual([]);
    expect(results).toHaveLength(10);
  });

  it("fails when the USDC account does not exist", async () => {
    const { rpc, state } = mockRpc();
    putMint(state, USDC, 6);
    expect(failed(await checkTreasury(rpc, MAINNET, TREASURY))).toEqual([
      "USDC associated token account exists",
    ]);
  });

  it("fails on another mint, another owner or wrong decimals", async () => {
    const { rpc, state } = mockRpc();
    putMint(state, USDC, 9);
    const ata = await associatedTokenAccount(TREASURY, USDC);
    putTokenAccount(state, ata, USDT, USDT, 0n);
    expect(failed(await checkTreasury(rpc, MAINNET, TREASURY))).toEqual([
      "Mint is exactly USDC",
      "Token account owner is the treasury",
      "USDC mint has 6 decimals on-chain",
    ]);
  });

  it("flags an off-curve (program-derived) owner: not a single-key wallet", async () => {
    const [pda] = await getProgramDerivedAddress({
      programAddress: address("SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu"),
      seeds: ["vault"],
    });
    const { rpc, state } = mockRpc();
    putMint(state, USDC, 6);
    putTokenAccount(state, await associatedTokenAccount(pda, USDC), pda, USDC, 0n);
    expect(failed(await checkTreasury(rpc, MAINNET, pda))).toEqual([
      "Treasury is a normal wallet address (on curve, single key)",
    ]);
  });

  it("rejects anything that is not an address, such as a secret key", async () => {
    const { rpc } = mockRpc();
    const secretLike = "4".repeat(88);
    expect(failed(await checkTreasury(rpc, MAINNET, secretLike))).toEqual([
      "Treasury is a base58 Solana address",
    ]);
  });
});
