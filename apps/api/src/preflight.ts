// Startup preflight with the mainnet gate closed (D71). With SOLANA_NETWORK=mainnet and
// MAINNET_ENABLED not true, the app runs read-only checks once, logs one OK/FAIL line per check,
// waits, and exits non-zero without ever opening its port (rule 11). Lines never contain a value
// of an environment variable: only names, public addresses and short error codes.
import {
  MAINNET,
  NETWORKS,
  type Network,
  type NetworkConfig,
  type SolanaRpc,
} from "@m2m-monster/core";
import { createSolanaRpc, getAddressFromPublicKey, isAddress } from "@solana/kit";
import { Redis } from "ioredis";
import postgres from "postgres";
import { Env, parseServiceKey } from "./config.js";
import { checkTreasury, MAINNET_GENESIS } from "./treasury-check.js";

/** Seconds the process waits after the preflight before exiting, so restarts stay slow. */
export const PREFLIGHT_EXIT_DELAY_SECONDS = 300;

export const GATE_MESSAGE = "SOLANA_NETWORK=mainnet refused: MAINNET_ENABLED is not true";

/** True when the app must not start: mainnet with the gate not explicitly on (fail closed). */
export function gateClosed(env: NodeJS.ProcessEnv): boolean {
  if (env.SOLANA_NETWORK !== "mainnet") return false;
  const gate = Env.shape.MAINNET_ENABLED.safeParse(env.MAINNET_ENABLED);
  return !(gate.success && gate.data === true);
}

export interface PreflightDeps {
  rpc: (url: string) => SolanaRpc;
  /** Connects, runs SELECT 1 and disconnects. No migrations, no writes. */
  postgres: (url: string) => Promise<void>;
  /** Connects, sends PING and disconnects. */
  redis: (url: string) => Promise<void>;
  networks?: Record<Network, NetworkConfig>;
}

export interface PreflightLine {
  ok: boolean;
  check: string;
  detail?: string;
}

/** A short, safe error label: a code like ECONNREFUSED or 28P01, else the error's class name. */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (
    (typeof code === "string" || typeof code === "number") &&
    /^[A-Za-z0-9_]{1,40}$/.test(`${code}`)
  ) {
    return `${code}`;
  }
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "error";
}

const HTTPS_ONLY = ["PUBLIC_BASE_URL", "API_BASE_URL"] as const;

/** Format of every variable the API reads: missing, empty or malformed. Never the value. */
function envLines(env: NodeJS.ProcessEnv): PreflightLine[] {
  const lines: PreflightLine[] = [];
  for (const [name, schema] of Object.entries(Env.shape)) {
    const value = env[name];
    const check = `env ${name}`;
    if (value === "") {
      lines.push({ ok: false, check, detail: "empty (delete the variable or give it a value)" });
      continue;
    }
    const parsed = (schema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(value);
    if (!parsed.success) {
      lines.push({ ok: false, check, detail: value === undefined ? "missing" : "malformed" });
    } else if (
      HTTPS_ONLY.includes(name as (typeof HTTPS_ONLY)[number]) &&
      value !== undefined &&
      !value.startsWith("https://")
    ) {
      lines.push({ ok: false, check, detail: "must start with https://" });
    } else {
      lines.push({ ok: true, check, detail: value === undefined ? "not set (default)" : "set" });
    }
  }
  // The image sets NODE_ENV=production, where Redis is mandatory.
  if (env.NODE_ENV === "production" && !env.REDIS_URL) {
    lines.push({ ok: false, check: "env REDIS_URL", detail: "required in production" });
  }
  return lines;
}

export async function preflight(
  env: NodeJS.ProcessEnv,
  deps: PreflightDeps,
): Promise<{ ok: boolean; lines: PreflightLine[] }> {
  const lines = envLines(env);
  const networks = deps.networks ?? NETWORKS;

  // Service key: only its public address.
  if (env.SERVICE_KEY) {
    try {
      const keys = await parseServiceKey(env.SERVICE_KEY);
      lines.push({
        ok: true,
        check: "service key",
        detail: `address ${await getAddressFromPublicKey(keys.publicKey)}`,
      });
    } catch {
      lines.push({ ok: false, check: "service key", detail: "not a valid base58 64-byte key" });
    }
  }

  // Treasury: public address from core (rule 9).
  const treasury = networks[MAINNET].treasury;
  const treasuryOk = typeof treasury === "string" && isAddress(treasury);
  lines.push(
    treasuryOk
      ? { ok: true, check: "treasury address (core)", detail: treasury }
      : { ok: false, check: "treasury address (core)", detail: "missing or invalid" },
  );

  // RPC: answers and is mainnet; then USDC decimals and the treasury's USDC account.
  const rpcUrl = Env.shape.SOLANA_RPC_URL.safeParse(env.SOLANA_RPC_URL);
  if (rpcUrl.success) {
    const rpc = deps.rpc(rpcUrl.data);
    let mainnet = false;
    try {
      const genesis = await rpc.getGenesisHash().send();
      mainnet = genesis === MAINNET_GENESIS;
      lines.push(
        mainnet
          ? { ok: true, check: "rpc", detail: "answers; mainnet genesis hash" }
          : { ok: false, check: "rpc", detail: "answers, but it is not mainnet" },
      );
    } catch (error) {
      lines.push({ ok: false, check: "rpc", detail: `no answer (${errorLabel(error)})` });
    }
    if (mainnet && treasuryOk) {
      try {
        for (const r of await checkTreasury(rpc, MAINNET, treasury)) {
          if (r.check === "Treasury is a base58 Solana address") continue;
          lines.push({
            ok: r.ok,
            check: `treasury: ${r.check}`,
            ...(r.detail && { detail: r.detail }),
          });
        }
      } catch (error) {
        lines.push({
          ok: false,
          check: "treasury USDC account",
          detail: `rpc error (${errorLabel(error)})`,
        });
      }
    }
  } else {
    lines.push({ ok: false, check: "rpc", detail: "skipped: SOLANA_RPC_URL is not valid" });
  }

  // Postgres and Redis: connect only.
  if (env.DATABASE_URL) {
    try {
      await deps.postgres(env.DATABASE_URL);
      lines.push({ ok: true, check: "postgres", detail: "connected; SELECT 1" });
    } catch (error) {
      lines.push({ ok: false, check: "postgres", detail: `failed (${errorLabel(error)})` });
    }
  } else {
    lines.push({ ok: false, check: "postgres", detail: "skipped: DATABASE_URL is not set" });
  }
  if (env.REDIS_URL) {
    try {
      await deps.redis(env.REDIS_URL);
      lines.push({ ok: true, check: "redis", detail: "PING answered" });
    } catch (error) {
      lines.push({ ok: false, check: "redis", detail: `failed (${errorLabel(error)})` });
    }
  } else {
    lines.push({ ok: false, check: "redis", detail: "skipped: REDIS_URL is not set" });
  }

  return { ok: lines.every((l) => l.ok), lines };
}

export function formatLine(line: PreflightLine): string {
  return `preflight ${line.ok ? "OK  " : "FAIL"} ${line.check}${line.detail ? `: ${line.detail}` : ""}`;
}

/** Real connections, read-only. */
export const defaultPreflightDeps: PreflightDeps = {
  rpc: (url) => createSolanaRpc(url) as unknown as SolanaRpc,
  async postgres(url) {
    const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
    try {
      await sql`select 1`;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  },
  async redis(url) {
    const redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 10_000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on("error", () => {}); // errors are reported by the awaited calls, without messages
    try {
      await redis.connect();
      if ((await redis.ping()) !== "PONG") throw new Error("NoPong");
    } finally {
      redis.disconnect();
    }
  },
};

export interface GateIo {
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  exit: (code: number) => never;
  deps: PreflightDeps;
  delaySeconds: number;
}

/** Runs the preflight once, logs it, waits and exits with code 1. Never opens the port. */
export async function refuseWithPreflight(env: NodeJS.ProcessEnv, io: GateIo): Promise<never> {
  io.log("preflight: mainnet gate closed; read-only checks, values are never printed");
  const { ok, lines } = await preflight(env, io.deps).catch(() => ({
    ok: false,
    lines: [{ ok: false, check: "preflight", detail: "could not run" }],
  }));
  for (const line of lines) io.log(formatLine(line));
  const failed = lines.filter((l) => !l.ok).length;
  io.log(`preflight: ${ok ? "all checks passed" : `${failed} check(s) failed`}`);
  io.log(`${GATE_MESSAGE}. Exiting in ${io.delaySeconds} s (one preflight per start).`);
  await io.sleep(io.delaySeconds * 1000);
  return io.exit(1);
}
