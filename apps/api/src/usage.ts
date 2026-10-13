// Daily usage from Postgres (D44): quotes issued, payments settled through the relay, receipts
// (relay and payee-reported), net fees and registered agents, per UTC day.
//   node dist/usage.js [days=30]      (DATABASE_URL in the environment)
import { formatUsd } from "@m2m-monster/core";
import { sql } from "drizzle-orm";
import type { Db } from "./db.js";

export interface UsageRow {
  day: string;
  quotes: number;
  relayed_payments: number;
  receipts: number;
  fees_net_usdc: string;
  agents_registered: number;
}

/** Days with any activity among the last `days` UTC days up to `now`, newest first. */
export async function usageByDay(db: Db, days: number, now: Date): Promise<UsageRow[]> {
  const today = now.toISOString().slice(0, 10);
  const result = await db.execute(sql`
    with days as (
      select generate_series(${today}::date - (${days}::int - 1), ${today}::date, interval '1 day')::date as day
    ),
    r as (
      select (issued_at at time zone 'UTC')::date as day,
             count(*) filter (where source = 'relay') as relayed,
             count(*) as receipts,
             coalesce(sum(fee_net), 0) as fees
      from receipts group by 1
    ),
    a as (
      select (registered_at at time zone 'UTC')::date as day, count(*) as agents from agents group by 1
    )
    select d.day::text as day,
           coalesce(u.quotes, 0)::int as quotes,
           coalesce(r.relayed, 0)::int as relayed,
           coalesce(r.receipts, 0)::int as receipts,
           coalesce(r.fees, 0)::text as fees,
           coalesce(a.agents, 0)::int as agents
    from days d
    left join daily_usage u on u.day = d.day
    left join r on r.day = d.day
    left join a on a.day = d.day
    order by d.day desc`);
  const rows =
    (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as never);
  return (rows as Record<string, unknown>[])
    .map((row) => ({
      day: String(row.day),
      quotes: Number(row.quotes),
      relayed_payments: Number(row.relayed),
      receipts: Number(row.receipts),
      fees_net_usdc: formatUsd(BigInt(String(row.fees))),
      agents_registered: Number(row.agents),
    }))
    .filter((r) => r.quotes || r.receipts || r.agents_registered);
}

if (process.argv[1]?.endsWith("usage.js")) {
  const { connectPostgres } = await import("./db.js");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const days = Number(process.argv[2] ?? 30);
  const rows = await usageByDay(await connectPostgres(url), days, new Date());
  console.table(rows);
  process.exit(0);
}
