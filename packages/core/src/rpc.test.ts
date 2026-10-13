import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  associatedTokenAccount,
  estimateComputeUnitPrice,
  mintDecimals,
  simulate,
  submitAndConfirm,
  tokenBalance,
} from "./rpc.js";
import { MAX_COMPUTE_UNIT_PRICE } from "./split.js";
import { mockRpc, putMint, putTokenAccount } from "./test-rpc.js";

const OWNER = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu" as Address;
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address;

describe("mintDecimals (section E)", () => {
  it("reads decimals from the mint account", async () => {
    const { rpc, state } = mockRpc();
    putMint(state, MINT, 6);
    expect(await mintDecimals(rpc, MINT)).toBe(6);
  });
});

describe("tokenBalance", () => {
  it("reads the owner's associated token account", async () => {
    const { rpc, state } = mockRpc();
    putTokenAccount(state, await associatedTokenAccount(OWNER, MINT), OWNER, MINT, 42n);
    expect(await tokenBalance(rpc, OWNER, MINT)).toBe(42n);
  });

  it("returns undefined when the account does not exist", async () => {
    const { rpc } = mockRpc();
    expect(await tokenBalance(rpc, OWNER, MINT)).toBeUndefined();
  });
});

describe("estimateComputeUnitPrice (D16)", () => {
  it("uses the 75th percentile of recent non-zero fees", async () => {
    const { rpc, state } = mockRpc();
    state.priorityFees = [0n, 100n, 200n, 300n, 400n, 500n];
    expect(await estimateComputeUnitPrice(rpc, [OWNER])).toBe(400n);
  });

  it("returns 0 when there is no fee pressure", async () => {
    const { rpc } = mockRpc();
    expect(await estimateComputeUnitPrice(rpc, [OWNER])).toBe(0n);
  });

  it("never exceeds 5 lamports per compute unit", async () => {
    const { rpc, state } = mockRpc();
    state.priorityFees = [MAX_COMPUTE_UNIT_PRICE * 10n];
    expect(await estimateComputeUnitPrice(rpc, [OWNER])).toBe(MAX_COMPUTE_UNIT_PRICE);
    expect(await estimateComputeUnitPrice(rpc, [OWNER], MAX_COMPUTE_UNIT_PRICE * 2n)).toBe(
      MAX_COMPUTE_UNIT_PRICE,
    );
  });

  it("honours a lower cap chosen by the agent", async () => {
    const { rpc, state } = mockRpc();
    state.priorityFees = [1_000n];
    expect(await estimateComputeUnitPrice(rpc, [OWNER], 10n)).toBe(10n);
  });
});

describe("simulate (section K)", () => {
  it("returns the compute units consumed", async () => {
    const { rpc } = mockRpc();
    expect(await simulate(rpc, "AA==", { sigVerify: false })).toBe(6_000n);
  });

  it("verifies signatures and keeps the blockhash when asked to", async () => {
    const { rpc, state } = mockRpc();
    await simulate(rpc, "AA==", { sigVerify: true });
    expect(state.simulated[0]?.config).toMatchObject({ sigVerify: true });
    expect(state.simulated[0]?.config.replaceRecentBlockhash).toBeUndefined();
  });

  it("throws SIMULATION_FAILED with the logs", async () => {
    const { rpc, state } = mockRpc();
    state.simulation = {
      err: { InstructionError: [2, { Custom: 1 }] },
      logs: ["insufficient funds"],
    };
    await expect(simulate(rpc, "AA==", { sigVerify: false })).rejects.toThrow(
      expect.objectContaining({
        code: "SIMULATION_FAILED",
        message: expect.stringContaining("insufficient funds"),
      }),
    );
  });
});

describe("submitAndConfirm", () => {
  it("returns the signature once confirmed", async () => {
    const { rpc, state } = mockRpc();
    const sig =
      "5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7";
    state.statuses.set(sig, { err: null, confirmationStatus: "confirmed" });
    expect(await submitAndConfirm(rpc, "AA==", { pollMs: 1 })).toBe(sig);
    expect(state.sent).toEqual(["AA=="]);
  });

  it("throws TRANSACTION_FAILED when the transaction fails on-chain", async () => {
    const { rpc, state } = mockRpc();
    const sig =
      "5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7";
    state.statuses.set(sig, {
      err: { InstructionError: [3, "x"] },
      confirmationStatus: "confirmed",
    });
    await expect(submitAndConfirm(rpc, "AA==", { pollMs: 1 })).rejects.toThrow(
      expect.objectContaining({ code: "TRANSACTION_FAILED" }),
    );
  });

  it("gives up when the blockhash expires", async () => {
    const { rpc } = mockRpc();
    await expect(
      submitAndConfirm(rpc, "AA==", { pollMs: 1, lastValidBlockHeight: 5n }),
    ).rejects.toThrow(expect.objectContaining({ code: "TRANSACTION_FAILED" }));
  });
});
