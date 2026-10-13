import { DEVNET, type KeyPair, MAINNET, NETWORKS, type Network } from "@m2m-monster/core";
import { createKeyPairFromBytes, getAddressFromPublicKey, getBase58Encoder } from "@solana/kit";
import { z } from "zod";

const Env = z.object({
  SOLANA_NETWORK: z.enum(["devnet", "mainnet"]),
  SOLANA_RPC_URL: z.url(),
  /** Base58 64-byte ed25519 secret key. Never holds funds (D7). */
  SERVICE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  /** Optional: without it, state is kept in process memory (single instance only). */
  REDIS_URL: z.string().optional(),
  PUBLIC_BASE_URL: z.url().default("https://m2m.monster"),
  PORT: z.coerce.number().int().default(3000),
  /** Take the client IP from the last X-Forwarded-For hop (behind one reverse proxy). */
  TRUST_PROXY: z.stringbool().default(false),
  RATE_LIMIT_IP_PER_MINUTE: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_PUBKEY_PER_MINUTE: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_API_KEY_PER_MINUTE: z.coerce.number().int().positive().default(600),
});

export interface Config {
  network: Network;
  treasury: string;
  rpcUrl: string;
  serviceKeys: KeyPair;
  serviceAddress: string;
  databaseUrl: string;
  redisUrl: string | undefined;
  publicBaseUrl: string;
  port: number;
  trustProxy: boolean;
  limits: { ip: number; pubkey: number; apiKey: number };
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const e = Env.parse(env);
  // Several instances must share rate limits, idempotency and nonces (section K).
  if (env.NODE_ENV === "production" && !e.REDIS_URL) {
    throw new Error("REDIS_URL is required in production");
  }
  const network = e.SOLANA_NETWORK === "mainnet" ? MAINNET : DEVNET;
  const treasury = NETWORKS[network].treasury;
  if (!treasury) throw new Error(`No treasury configured for ${e.SOLANA_NETWORK}`);
  const serviceKeys = await createKeyPairFromBytes(getBase58Encoder().encode(e.SERVICE_KEY));
  return {
    network,
    treasury,
    rpcUrl: e.SOLANA_RPC_URL,
    serviceKeys,
    serviceAddress: await getAddressFromPublicKey(serviceKeys.publicKey),
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL || undefined,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    limits: {
      ip: e.RATE_LIMIT_IP_PER_MINUTE,
      pubkey: e.RATE_LIMIT_PUBKEY_PER_MINUTE,
      apiKey: e.RATE_LIMIT_API_KEY_PER_MINUTE,
    },
  };
}
