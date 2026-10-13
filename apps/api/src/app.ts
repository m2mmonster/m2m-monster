import { createHash, randomBytes } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  ERRORS,
  type KeyPair,
  M2mError,
  type Network,
  QUOTE_TTL_SECONDS,
  type SolanaRpc,
} from "@m2m-monster/core";
import { mcpHttpHandler } from "@m2m-monster/mcp";
import { createApiClient } from "@m2m-monster/sdk";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { authenticatedAgent, registerAgentRoutes, withDiscounts } from "./agents.js";
import { registerBuildRoutes } from "./builds.js";
import type { Db } from "./db.js";
import { registerDemoRoutes } from "./demo.js";
import { errorBody, errorResponse } from "./errors.js";
import type { Kv } from "./kv.js";
import { registerPaymentRoutes } from "./payments.js";
import { registerPublicRoutes } from "./public.js";
import { createQuote, quoteRoute } from "./quotes.js";
import { dailyUsage } from "./schema.js";
import { errorsRoute, serviceKeyRoute } from "./schemas.js";

export interface AppDeps {
  network: Network;
  treasury: string;
  serviceKeys: KeyPair;
  serviceAddress: string;
  kv: Kv;
  db: Db;
  /** Reads, simulates and broadcasts; never signs (rule 3). */
  rpc: SolanaRpc;
  /** On-chain decimals of a mint (section E). */
  mintDecimals: (mint: string) => Promise<number>;
  /** Milliseconds since the epoch. */
  now: () => number;
  publicBaseUrl: string;
  clientIp: (c: Context) => string;
  limits: { ip: number; pubkey: number; apiKey: number };
  /** Receives one JSON line per request: method, path, status, duration (D44). */
  log?: (line: string) => void;
}

const MINUTE = 60_000;
const IDEMPOTENCY_TTL = 24 * 60 * MINUTE;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export interface Helpers {
  sha256: (value: string) => string;
  /** Fixed one-minute window per key (section K, D17). */
  limit: (scope: string, id: string, max: number) => Promise<void>;
  /**
   * Runs `compute` once per idempotency key and returns the stored result on retries
   * (section K). The same key with a different request gets IDEMPOTENCY_KEY_REUSED.
   */
  idempotent: <T>(
    scope: string,
    idempotencyKey: string,
    request: string,
    compute: () => Promise<T>,
  ) => Promise<T>;
}

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        const where = issue?.path.join(".");
        return c.json(
          errorBody("INVALID_REQUEST", `${where ? `${where}: ` : ""}${issue?.message}`),
          400,
        );
      }
    },
  });

  const limit: Helpers["limit"] = async (scope, id, max) => {
    const window = Math.floor(deps.now() / MINUTE);
    const count = await deps.kv.incr(`rl:${scope}:${id}:${window}`, MINUTE);
    if (count > max) throw new M2mError("RATE_LIMITED");
  };

  const idempotent: Helpers["idempotent"] = async (scope, idempotencyKey, request, compute) => {
    const key = `idem:${scope}:${sha256(idempotencyKey)}`;
    const fingerprint = sha256(request);
    const stored = async () => {
      const record = await deps.kv.get(key);
      if (!record) return undefined;
      const parsed = JSON.parse(record) as { fingerprint: string; result: never };
      if (parsed.fingerprint !== fingerprint) throw new M2mError("IDEMPOTENCY_KEY_REUSED");
      return parsed.result;
    };
    const previous = await stored();
    if (previous !== undefined) return previous;
    const result = await compute();
    const saved = await deps.kv.setIfAbsent(
      key,
      JSON.stringify({ fingerprint, result }),
      IDEMPOTENCY_TTL,
    );
    return saved ? result : ((await stored()) ?? result);
  };

  // Minimal request log: no headers, api_key, IPs, query strings or bodies (D44).
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    deps.log?.(
      JSON.stringify({
        t: new Date(deps.now()).toISOString(),
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      }),
    );
  });

  app.onError((err, c) => {
    if (err instanceof M2mError && err.code === "RATE_LIMITED") {
      c.header("Retry-After", `${60 - (Math.floor(deps.now() / 1000) % 60)}`);
    }
    return errorResponse(c, err);
  });

  app.use("/v1/*", async (c, next) => {
    await limit("ip", deps.clientIp(c), deps.limits.ip);
    const auth = c.req.header("authorization");
    if (auth) await limit("key", sha256(auth), deps.limits.apiKey);
    await next();
  });

  app.openapi(quoteRoute, async (c) => {
    const body = c.req.valid("json");
    const { "idempotency-key": idempotencyKey } = c.req.valid("header");
    if (body.network !== deps.network) {
      throw new M2mError("INVALID_REQUEST", `This deployment serves ${deps.network} only.`);
    }
    await limit("pubkey", body.payee, deps.limits.pubkey);

    // Discounts apply only when the payee itself asks for the quote (D33).
    const agent = await authenticatedAgent(deps, c);
    const payee = agent?.pubkey === body.payee ? agent : undefined;
    const quote = await idempotent(
      "quote",
      idempotencyKey,
      JSON.stringify([body.network, body.mint, body.amount, body.payee, payee?.pubkey ?? null]),
      async () => {
        const id = `q_${randomId()}`;
        const expiresAt = Math.floor(deps.now() / 1000) + QUOTE_TTL_SECONDS;
        const priced = await withDiscounts(deps, payee, id, expiresAt, (discounts) =>
          createQuote(
            deps,
            body,
            { id, nonce: randomBytes(16).toString("hex"), expiresAt },
            discounts,
          ),
        );
        await countQuote(deps);
        return priced.quote;
      },
    );
    return c.json(quote, 201);
  });

  registerPaymentRoutes(app, deps, { sha256, limit, idempotent });
  registerAgentRoutes(app, deps);
  registerBuildRoutes(app, deps);
  registerPublicRoutes(app, deps);
  registerDemoRoutes(app, deps);

  // MCP over streamable HTTP (section L, D20). Its API calls stay in process and keep the
  // caller's connection, so rate limits see the real client.
  app.all("/mcp", (c) =>
    mcpHttpHandler((apiKey) =>
      createApiClient(deps.publicBaseUrl, {
        fetch: (request) => Promise.resolve(app.fetch(request, c.env)),
        ...(apiKey && { apiKey }),
      }),
    )(c.req.raw),
  );

  app.openapi(errorsRoute, (c) => c.json(ERRORS, 200));
  app.openapi(serviceKeyRoute, (c) => c.json({ address: deps.serviceAddress }, 200));

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "m2m.monster API",
      version: "1.0.0",
      description:
        "Non-custodial settlement for agent-to-agent payments over x402 with the m2m-split scheme on Solana. Every endpoint that moves funds returns unsigned transactions; agents sign locally.",
    },
    servers: [{ url: deps.publicBaseUrl }],
  });

  return app;
}

/** One more quote for today's UTC date (D44). */
async function countQuote(deps: AppDeps) {
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  await deps.db
    .insert(dailyUsage)
    .values({ day, quotes: 1 })
    .onConflictDoUpdate({ target: dailyUsage.day, set: { quotes: sql`${dailyUsage.quotes} + 1` } });
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** 22 base58 characters (about 128 bits). */
function randomId(): string {
  return Array.from(randomBytes(22), (b) => BASE58[b % 58]).join("");
}
