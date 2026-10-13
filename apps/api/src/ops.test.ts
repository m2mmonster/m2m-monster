// Request log (method, path, status, duration only) and the daily usage summary from Postgres.
import { DEVNET, NETWORKS, type SignedQuote } from "@m2m-monster/core";
import { signatureOf } from "@m2m-monster/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { json, payerTransaction, START, signer, testApp } from "./test-app.js";
import { usageByDay } from "./usage.js";

const USDC = NETWORKS[DEVNET].usdc;
const DAY = 24 * 60 * 60 * 1000;

let lines: string[];
let ctx: Awaited<ReturnType<typeof testApp>>;

beforeEach(async () => {
  lines = [];
  ctx = await testApp({ log: (line) => lines.push(line) });
});

const quote = async (key = `q-${crypto.randomUUID()}`, headers: Record<string, string> = {}) => {
  const payee = await signer(2);
  const res = await ctx.app.request(
    "/v1/quotes",
    json(
      { network: DEVNET, mint: USDC, amount: "10000000", payee: payee.address },
      { "idempotency-key": key, ...headers },
    ),
  );
  return (await res.json()) as SignedQuote;
};

describe("request log", () => {
  it("logs method, path, status and duration only", async () => {
    await quote("log-key-12345678", { authorization: "Bearer m2m_secretvalue" });
    await ctx.app.request("/.well-known/mcp.json?ref=9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu");
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((l) => JSON.parse(l));
    expect(Object.keys(first).sort()).toEqual(["method", "ms", "path", "status", "t"]);
    expect(first).toMatchObject({ method: "POST", path: "/v1/quotes", status: 401 });
    expect(second).toMatchObject({ method: "GET", path: "/.well-known/mcp.json", status: 200 });
    expect(typeof first.ms).toBe("number");
    const all = lines.join("\n");
    for (const secret of ["m2m_secretvalue", "Bearer", "203.0.113.7", "log-key-12345678", "ref="]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("usage by day (Postgres)", () => {
  it("counts quotes, settled payments, receipts and registered agents per day", async () => {
    const payer = await signer(1);
    ctx.state.autoConfirm = true;

    // Day 1: two quotes (a retry with the same key counts once), one relayed payment.
    const q1 = await quote("day1-quote-1234");
    await quote("day1-quote-1234");
    await quote();
    const { signed } = await payerTransaction(q1, payer);
    await ctx.app.request(
      "/v1/payments",
      json({ quote: q1, transaction: signed }, { "idempotency-key": "day1-pay-12345" }),
    );

    // Day 2: one quote paid by the payee itself and reported for a receipt.
    ctx.clock.now = START + DAY;
    const q2 = await quote();
    const second = await payerTransaction(q2, payer);
    ctx.state.transactions.set(signatureOf(second.signed), { wire: second.signed, err: null });
    await ctx.app.request(
      "/v1/receipts",
      json({ quote: q2, signature: signatureOf(second.signed) }),
    );

    const rows = await usageByDay(ctx.deps.db, 7, new Date(START + DAY));
    const day = (offset: number) => new Date(START + offset * DAY).toISOString().slice(0, 10);
    expect(rows).toEqual([
      {
        day: day(1),
        quotes: 1,
        relayed_payments: 0,
        receipts: 1,
        fees_net_usdc: "0.025",
        agents_registered: 0,
      },
      {
        day: day(0),
        quotes: 2,
        relayed_payments: 1,
        receipts: 1,
        fees_net_usdc: "0.025",
        agents_registered: 0,
      },
    ]);
  });
});
