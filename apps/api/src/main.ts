import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { mintDecimals as readMintDecimals } from "@m2m-monster/core";
import { address, createSolanaRpc } from "@solana/kit";
import type { Context } from "hono";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectPostgres } from "./db.js";
import { memoryKv, redisKv } from "./kv.js";

const config = await loadConfig();
const rpc = createSolanaRpc(config.rpcUrl);

// Decimals are read on-chain and never change; cache them per process (section E).
const decimals = new Map<string, Promise<number>>();
const mintDecimals = (mint: string) => {
  let cached = decimals.get(mint);
  if (!cached) {
    cached = readMintDecimals(rpc, address(mint));
    cached.catch(() => decimals.delete(mint));
    decimals.set(mint, cached);
  }
  return cached;
};

const clientIp = (c: Context) => {
  const forwarded = config.trustProxy ? c.req.header("x-forwarded-for") : undefined;
  return forwarded?.split(",").at(-1)?.trim() || getConnInfo(c).remote.address || "unknown";
};

if (!config.redisUrl)
  console.warn("REDIS_URL not set: using in-process memory (single instance only)");

const app = createApp({
  network: config.network,
  treasury: config.treasury,
  serviceKeys: config.serviceKeys,
  serviceAddress: config.serviceAddress,
  kv: config.redisUrl ? redisKv(config.redisUrl) : memoryKv(),
  db: await connectPostgres(config.databaseUrl),
  rpc,
  mintDecimals,
  now: Date.now,
  publicBaseUrl: config.publicBaseUrl,
  clientIp,
  limits: config.limits,
  log: (line) => console.log(line),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`m2m.monster API on :${info.port} (${config.network})`);
});
