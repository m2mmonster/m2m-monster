// Startup configuration: mainnet gate (rule 11), treasury address (rule 9), base URLs.
import { DEVNET, MAINNET, NETWORKS, type NetworkConfig } from "@m2m-monster/core";
import { createKeyPairFromPrivateKeyBytes, getBase58Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/** A throwaway test service key (all-9 seed), as base58 secret + public key. */
async function serviceKey(): Promise<string> {
  const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9), true);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return getBase58Decoder().decode(new Uint8Array([...new Uint8Array(32).fill(9), ...pub]));
}

const env = async (extra: Record<string, string> = {}) => ({
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.example",
  SERVICE_KEY: await serviceKey(),
  DATABASE_URL: "postgres://localhost/db",
  ...extra,
});

const TREASURY = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";
const withMainnetTreasury = (treasury: string | undefined) => ({
  ...NETWORKS,
  [MAINNET]: { ...NETWORKS[MAINNET], treasury } as NetworkConfig,
});

describe("loadConfig", () => {
  it("starts on Devnet with the API base URL defaulting to the public one", async () => {
    const config = await loadConfig(await env({ PUBLIC_BASE_URL: "https://sandbox.example/" }));
    expect(config.network).toBe(DEVNET);
    expect(config.publicBaseUrl).toBe("https://sandbox.example");
    expect(config.apiBaseUrl).toBe("https://sandbox.example");
  });

  it("takes a separate API_BASE_URL", async () => {
    const config = await loadConfig(
      await env({
        PUBLIC_BASE_URL: "https://m2m.monster",
        API_BASE_URL: "https://api.m2m.monster/",
      }),
    );
    expect(config.publicBaseUrl).toBe("https://m2m.monster");
    expect(config.apiBaseUrl).toBe("https://api.m2m.monster");
  });

  it("refuses mainnet unless MAINNET_ENABLED is true (fail closed by default)", async () => {
    const networks = withMainnetTreasury(TREASURY);
    await expect(loadConfig(await env({ SOLANA_NETWORK: "mainnet" }), networks)).rejects.toThrow(
      /MAINNET_ENABLED/,
    );
    await expect(
      loadConfig(await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "false" }), networks),
    ).rejects.toThrow(/MAINNET_ENABLED/);
    const config = await loadConfig(
      await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "true" }),
      networks,
    );
    expect(config).toMatchObject({ network: MAINNET, treasury: TREASURY });
  });

  it("the real mainnet configuration: refused with the gate off, accepted with it on", async () => {
    expect(NETWORKS[MAINNET].treasury).toBe("D68nkVrQD3pcs6qNcadXqWvoKqsNCKpLemy3zYVmGHym");
    await expect(loadConfig(await env({ SOLANA_NETWORK: "mainnet" }))).rejects.toThrow(
      /MAINNET_ENABLED/,
    );
    await expect(
      loadConfig(await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "false" })),
    ).rejects.toThrow(/MAINNET_ENABLED/);
    const config = await loadConfig(
      await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "true" }),
    );
    expect(config).toMatchObject({
      network: MAINNET,
      treasury: "D68nkVrQD3pcs6qNcadXqWvoKqsNCKpLemy3zYVmGHym",
    });
  });

  it("refuses mainnet when no treasury address is set", async () => {
    await expect(
      loadConfig(
        await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "true" }),
        withMainnetTreasury(undefined),
      ),
    ).rejects.toThrow(/No treasury configured for mainnet/);
  });

  it("refuses an invalid treasury address", async () => {
    for (const treasury of ["not-an-address", "", "0".repeat(44)]) {
      await expect(
        loadConfig(
          await env({ SOLANA_NETWORK: "mainnet", MAINNET_ENABLED: "true" }),
          withMainnetTreasury(treasury),
        ),
      ).rejects.toThrow(/treasury/);
    }
  });

  it("a malformed SERVICE_KEY fails without its value in the error (no secret in logs)", async () => {
    const secretLike = "SECRETkeyMATERIAL0OIl"; // invalid base58 characters: 0, O, I, l
    const wrongLength = (await serviceKey()).slice(0, 40);
    const withNewline = `${await serviceKey()}
`;
    for (const value of [secretLike, wrongLength, withNewline]) {
      const error = (await loadConfig(await env({ SERVICE_KEY: value })).catch((e) => e)) as Error;
      expect(error.message).toMatch(/SERVICE_KEY is not a valid base58 64-byte key/);
      const encoded = Buffer.from(value).toString("base64");
      for (const text of [error.message, String(error.stack), JSON.stringify(error)]) {
        expect(text).not.toContain(value.trim());
        expect(text).not.toContain(encoded);
      }
    }
  });

  it("configuration errors name the variable, never its value", async () => {
    const error = (await loadConfig(
      await env({ SOLANA_RPC_URL: "not a url with-api-key-SECRET123" }),
    ).catch((e) => e)) as Error;
    expect(String(error.message)).toMatch(/SOLANA_RPC_URL/);
    expect(String(error.message)).not.toContain("SECRET123");
  });

  it("requires Redis in production", async () => {
    await expect(loadConfig({ ...(await env()), NODE_ENV: "production" })).rejects.toThrow(
      /REDIS_URL/,
    );
  });
});
