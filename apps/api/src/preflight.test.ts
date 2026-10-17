// Preflight with the mainnet gate closed (D71): read-only checks, one line each, no values.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { associatedTokenAccount, MAINNET, NETWORKS, type SolanaRpc } from "@m2m-monster/core";
import { mockRpc, putMint, putTokenAccount } from "@m2m-monster/core/testing";
import {
  address,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  GATE_MESSAGE,
  gateClosed,
  type PreflightDeps,
  preflight,
  refuseWithPreflight,
} from "./preflight.js";
import { MAINNET_GENESIS } from "./treasury-check.js";

const TREASURY = address(NETWORKS[MAINNET].treasury as string);
const USDC = address(NETWORKS[MAINNET].usdc);

async function serviceKey() {
  const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9), true);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    secret: getBase58Decoder().decode(new Uint8Array([...new Uint8Array(32).fill(9), ...pub])),
    address: await getAddressFromPublicKey(pair.publicKey),
  };
}

/** Secret-looking values: none of them, nor their base64, may reach the log. */
const SECRETS = {
  SOLANA_RPC_URL: "https://rpc.example/?api-key=RPCSECRET123",
  DATABASE_URL: "postgres://m2m:PGSECRET456@db:5432/m2m",
  REDIS_URL: "redis://:REDISSECRET789@redis:6379",
};

async function env(extra: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    SOLANA_NETWORK: "mainnet",
    MAINNET_ENABLED: "false",
    SERVICE_KEY: (await serviceKey()).secret,
    ...SECRETS,
    PUBLIC_BASE_URL: "https://m2m.monster",
    API_BASE_URL: "https://api.m2m.monster",
    TRUST_PROXY: "true",
    ...extra,
  } as NodeJS.ProcessEnv;
}

/** A healthy mainnet as seen through the mock RPC. */
async function healthy(change: (state: ReturnType<typeof mockRpc>["state"]) => void = () => {}) {
  const { rpc, state } = mockRpc();
  putMint(state, USDC, 6);
  putTokenAccount(state, await associatedTokenAccount(TREASURY, USDC), TREASURY, USDC, 0n);
  change(state);
  const withGenesis = {
    ...(rpc as unknown as Record<string, unknown>),
    getGenesisHash: () => ({
      send: async () => {
        if (state.failing.has("getGenesisHash"))
          throw Object.assign(new Error("RPCSECRET123"), { code: "ECONNREFUSED" });
        return state.failing.has("notMainnet")
          ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
          : MAINNET_GENESIS;
      },
    }),
  } as unknown as SolanaRpc;
  return withGenesis;
}

function deps(rpc: SolanaRpc, fail: { postgres?: boolean; redis?: boolean } = {}): PreflightDeps {
  return {
    rpc: () => rpc,
    postgres: async (url) => {
      if (fail.postgres) {
        throw Object.assign(new Error(`password authentication failed for ${url}`), {
          code: "28P01",
        });
      }
    },
    redis: async (url) => {
      if (fail.redis)
        throw Object.assign(new Error(`connect failed ${url}`), { code: "ECONNREFUSED" });
    },
  };
}

const failing = (lines: { ok: boolean; check: string }[]) =>
  lines.filter((l) => !l.ok).map((l) => l.check);

/** Values long enough to be secrets or URLs (words like "mainnet" or "true" appear legitimately). */
function expectNoValues(text: string, values: (string | undefined)[]) {
  for (const value of values) {
    if (!value || value.length < 12) continue;
    expect(text).not.toContain(value);
    expect(text).not.toContain(Buffer.from(value).toString("base64"));
  }
  for (const marker of ["RPCSECRET123", "PGSECRET456", "REDISSECRET789"]) {
    expect(text).not.toContain(marker);
  }
}

describe("gateClosed (rule 11)", () => {
  it("closed on mainnet unless MAINNET_ENABLED is explicitly true", () => {
    for (const v of [undefined, "", "false", "0", "si", "TRUE "]) {
      expect(gateClosed({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: v }), String(v)).toBe(true);
    }
    for (const v of ["true", "1", "yes", "on"]) {
      expect(gateClosed({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: v }), v).toBe(false);
    }
    expect(gateClosed({ SOLANA_NETWORK: "devnet" })).toBe(false);
  });
});

describe("preflight (D71)", () => {
  it("all checks pass on a healthy configuration, with the service key's public address only", async () => {
    const e = await env();
    const { ok, lines } = await preflight(e, deps(await healthy()));
    expect(failing(lines)).toEqual([]);
    expect(ok).toBe(true);
    const text = lines.map((l) => `${l.check} ${l.detail ?? ""}`).join("\n");
    expect(text).toContain(`address ${(await serviceKey()).address}`);
    expect(text).toContain("mainnet genesis hash");
    expect(text).toContain("USDC associated token account exists");
    expect(text).toContain("SELECT 1");
    expect(text).toContain("PING");
    expectNoValues(text, Object.values(e));
  });

  const cases: [
    string,
    Record<string, string | undefined>,
    (s: ReturnType<typeof mockRpc>["state"]) => void,
    { postgres?: boolean; redis?: boolean },
    string[],
  ][] = [
    ["empty variable", { PORT: "" }, () => {}, {}, ["env PORT"]],
    ["malformed variable", { API_BASE_URL: "api.m2m.monster" }, () => {}, {}, ["env API_BASE_URL"]],
    [
      "http base URL",
      { PUBLIC_BASE_URL: "http://m2m.monster" },
      () => {},
      {},
      ["env PUBLIC_BASE_URL"],
    ],
    [
      "missing variable",
      { DATABASE_URL: undefined },
      () => {},
      {},
      ["env DATABASE_URL", "postgres"],
    ],
    ["bad service key", { SERVICE_KEY: "SECRETkeyMATERIAL0OIl" }, () => {}, {}, ["service key"]],
    ["RPC down", {}, (s) => s.failing.add("getGenesisHash"), {}, ["rpc"]],
    ["RPC not mainnet", {}, (s) => s.failing.add("notMainnet"), {}, ["rpc"]],
    [
      "USDC decimals",
      {},
      (s) => putMint(s, USDC, 9),
      {},
      ["treasury: USDC mint has 6 decimals on-chain"],
    ],
    [
      "treasury USDC account missing",
      {},
      (s) => s.accounts.clear(),
      {},
      [
        "treasury: USDC associated token account exists",
        "treasury: USDC mint has 6 decimals on-chain",
      ],
    ],
    ["Postgres", {}, () => {}, { postgres: true }, ["postgres"]],
    ["Redis", {}, () => {}, { redis: true }, ["redis"]],
  ];

  for (const [name, extra, change, fail, expected] of cases) {
    it(`reports only ${name}, and no value`, async () => {
      const e = await env(extra);
      const { ok, lines } = await preflight(e, deps(await healthy(change), fail));
      expect(ok).toBe(false);
      expect(failing(lines)).toEqual(expected);
      expectNoValues(lines.map((l) => `${l.check} ${l.detail ?? ""}`).join("\n"), Object.values(e));
    });
  }

  it("refuses after one preflight: logs every line, waits, exits 1", async () => {
    const logged: string[] = [];
    const waits: number[] = [];
    let exitCode: number | undefined;
    const e = await env({ REDIS_URL: undefined });
    await refuseWithPreflight(e, {
      log: (l) => logged.push(l),
      sleep: async (ms) => {
        waits.push(ms);
      },
      exit: ((code: number) => {
        exitCode = code;
      }) as never,
      deps: deps(await healthy()),
      delaySeconds: 300,
    });
    expect(waits).toEqual([300_000]);
    expect(exitCode).toBe(1);
    expect(logged.at(-1)).toContain(GATE_MESSAGE);
    expect(logged).toContain("preflight FAIL env REDIS_URL: required in production");
    expect(
      logged.filter((l) => l.startsWith("preflight OK") || l.startsWith("preflight FAIL")).length,
    ).toBeGreaterThan(15);
    expectNoValues(logged.join("\n"), Object.values(e));
  });
});

describe("the real entrypoint with the gate closed", () => {
  it("never listens on its port and prints no value", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    const e = await env({
      PORT: `${port}`,
      SOLANA_RPC_URL: "http://127.0.0.1:1/?api-key=RPCSECRET123",
      DATABASE_URL: "postgres://m2m:PGSECRET456@127.0.0.1:1/m2m",
      REDIS_URL: "redis://:REDISSECRET789@127.0.0.1:1",
      PUBLIC_BASE_URL: "https://m2m.monster",
    });
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const main = fileURLToPath(new URL("./main.ts", import.meta.url));
    const child = spawn(process.execPath, [tsx, "--conditions=m2m-source", main], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...e },
    });
    let output = "";
    child.stdout.on("data", (d) => {
      output += d;
    });
    child.stderr.on("data", (d) => {
      output += d;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no gate message:\n${output}`)), 60_000);
        const poll = setInterval(() => {
          if (output.includes(GATE_MESSAGE)) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }
        }, 100);
      });
      const listening = await new Promise<boolean>((resolve) => {
        const socket = new Socket();
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.connect(port, "127.0.0.1");
      });
      expect(listening).toBe(false);
      expect(child.exitCode).toBeNull(); // still waiting before exiting
      expect(output).toContain("preflight FAIL rpc: no answer");
      expect(output).toContain("preflight FAIL postgres: failed");
      expect(output).toContain("preflight FAIL redis: failed");
      expectNoValues(output, Object.values(e));
    } finally {
      child.kill();
    }
  }, 90_000);
});
