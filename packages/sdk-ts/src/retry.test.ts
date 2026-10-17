// The retry decision shared with the Python SDK (spec/test-vectors/retry.json, D66).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chainEvidence, decideRetry, type RetryEvidence } from "./retry.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/test-vectors/retry.json", import.meta.url), "utf8"),
) as { cases: { name: string; evidence: RetryEvidence; expected: string }[] };

describe("retry decision vectors", () => {
  it("has cases", () => {
    expect(vectors.cases.length).toBeGreaterThan(10);
  });
  for (const { name, evidence, expected } of vectors.cases) {
    it(name, () => {
      expect(decideRetry(evidence)).toBe(expected);
    });
  }
});

describe("chain evidence (D67)", () => {
  type Calls = { method: string; config: unknown }[];
  const fakeRpc = (
    epoch: unknown,
    statuses: unknown,
    calls: Calls = [],
  ): Parameters<typeof chainEvidence>[0] =>
    ({
      getEpochInfo: (config: unknown) => {
        calls.push({ method: "getEpochInfo", config });
        return { send: async () => (epoch instanceof Error ? Promise.reject(epoch) : epoch) };
      },
      getSignatureStatuses: (_s: unknown, config: unknown) => {
        calls.push({ method: "getSignatureStatuses", config });
        return {
          send: async () => (statuses instanceof Error ? Promise.reject(statuses) : statuses),
        };
      },
    }) as never;
  const SIG = "5".repeat(87);
  const epoch = (blockHeight: bigint, absoluteSlot = 500n) => ({ blockHeight, absoluteSlot });
  const notFound = (slot = 500n) => ({ context: { slot }, value: [null] });

  it("reads the finalized height first, then the status with history", async () => {
    const calls: Calls = [];
    await chainEvidence(fakeRpc(epoch(10n), notFound(), calls), SIG, 1_000n);
    expect(calls).toEqual([
      { method: "getEpochInfo", config: { commitment: "finalized" } },
      { method: "getSignatureStatuses", config: { searchTransactionHistory: true } },
    ]);
  });

  it("expired only when the finalized height is above lastValidBlockHeight", async () => {
    const at = (h: bigint) => chainEvidence(fakeRpc(epoch(h), notFound()), SIG, 1_000n);
    expect((await at(999n)).blockhash_expired).toBe(false);
    expect((await at(1_000n)).blockhash_expired).toBe(false); // still valid at its last height
    expect((await at(1_001n)).blockhash_expired).toBe(true);
  });

  it("a 'not found' from a node behind the finalized slot is not trusted", async () => {
    const lagging = await chainEvidence(fakeRpc(epoch(2_000n, 500n), notFound(499n)), SIG, 1_000n);
    expect(lagging).toEqual({ signature_status: "rpc_error", blockhash_expired: true });
    expect(decideRetry({ settlement: "other", receipt: null, ...lagging })).toBe("unknown");
    const fresh = await chainEvidence(fakeRpc(epoch(2_000n, 500n), notFound(500n)), SIG, 1_000n);
    expect(decideRetry({ settlement: "other", receipt: null, ...fresh })).toBe("not_paid");
  });

  it("malformed or failing answers are RPC errors", async () => {
    const cases: [unknown, unknown][] = [
      [{}, notFound()],
      [epoch(2_000n), {}],
      [epoch(2_000n), { context: {}, value: [null] }],
      [new Error("down"), notFound()],
      [epoch(2_000n), new Error("down")],
      [epoch(2_000n), { context: { slot: 500n }, value: ["weird"] }],
    ];
    for (const [e, s] of cases) {
      const evidence = await chainEvidence(fakeRpc(e, s), SIG, 1_000n);
      expect(decideRetry({ settlement: "other", receipt: null, ...evidence })).toBe("unknown");
    }
  });

  it("err wins over a confirmation status; processed or unknown statuses stay unknown", async () => {
    const status = (v: unknown) => ({ context: { slot: 500n }, value: [v] });
    const failed = await chainEvidence(
      fakeRpc(
        epoch(10n),
        status({ err: { InstructionError: [2, "Custom"] }, confirmationStatus: "confirmed" }),
      ),
      SIG,
      1_000n,
    );
    expect(failed.signature_status).toBe("failed");
    for (const confirmationStatus of ["processed", null, "something"]) {
      const e = await chainEvidence(
        fakeRpc(epoch(2_000n), status({ err: null, confirmationStatus })),
        SIG,
        1_000n,
      );
      expect(e.signature_status).toBe("processed");
      expect(decideRetry({ settlement: "other", receipt: null, ...e })).toBe("unknown");
    }
  });
});
