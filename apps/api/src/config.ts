import {
  DEVNET,
  type KeyPair,
  MAINNET,
  NETWORKS,
  type Network,
  type NetworkConfig,
} from "@m2m-monster/core";
import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase58Encoder,
  isAddress,
} from "@solana/kit";
import { z } from "zod";

export const Env = z.object({
  SOLANA_NETWORK: z.enum(["devnet", "mainnet"]),
  /** Mainnet gate (rule 11): with SOLANA_NETWORK=mainnet the API refuses to start unless true. */
  MAINNET_ENABLED: z.stringbool().default(false),
  SOLANA_RPC_URL: z.url(),
  /** Base58 64-byte ed25519 secret key. Never holds funds (D7). */
  SERVICE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  /** Optional: without it, state is kept in process memory (single instance only). */
  REDIS_URL: z.string().optional(),
  /** Public files and referral links. */
  PUBLIC_BASE_URL: z.url().default("https://m2m.monster"),
  /** /v1 API, relay and /mcp; defaults to PUBLIC_BASE_URL. */
  API_BASE_URL: z.url().optional(),
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
  apiBaseUrl: string;
  port: number;
  trustProxy: boolean;
  limits: { ip: number; pubkey: number; apiKey: number };
}

/**
 * Decodes SERVICE_KEY. Decoder errors are replaced by a generic one: @solana/kit puts the input in
 * its error message (in production as base64 context), which would write the secret to the logs.
 */
export async function parseServiceKey(value: string) {
  try {
    return await createKeyPairFromBytes(getBase58Encoder().encode(value));
  } catch {
    throw new Error(
      "SERVICE_KEY is not a valid base58 64-byte key (secret + public key, as printed by keygen)",
    );
  }
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  networks: Record<Network, NetworkConfig> = NETWORKS,
): Promise<Config> {
  const e = Env.parse(env);
  // Fail closed: mainnet needs the user's explicit permission (rule 11).
  if (e.SOLANA_NETWORK === "mainnet" && !e.MAINNET_ENABLED) {
    throw new Error("SOLANA_NETWORK=mainnet refused: MAINNET_ENABLED is not true");
  }
  // Several instances must share rate limits, idempotency and nonces (section K).
  if (env.NODE_ENV === "production" && !e.REDIS_URL) {
    throw new Error("REDIS_URL is required in production");
  }
  const network = e.SOLANA_NETWORK === "mainnet" ? MAINNET : DEVNET;
  // Only the treasury's public address is known, set in core (rule 9).
  const treasury = networks[network].treasury;
  if (!treasury) throw new Error(`No treasury configured for ${e.SOLANA_NETWORK}`);
  if (!isAddress(treasury)) throw new Error(`Invalid treasury address for ${e.SOLANA_NETWORK}`);
  const serviceKeys = await parseServiceKey(e.SERVICE_KEY);
  return {
    network,
    treasury,
    rpcUrl: e.SOLANA_RPC_URL,
    serviceKeys,
    serviceAddress: await getAddressFromPublicKey(serviceKeys.publicKey),
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL || undefined,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    apiBaseUrl: (e.API_BASE_URL ?? e.PUBLIC_BASE_URL).replace(/\/$/, ""),
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    limits: {
      ip: e.RATE_LIMIT_IP_PER_MINUTE,
      pubkey: e.RATE_LIMIT_PUBKEY_PER_MINUTE,
      apiKey: e.RATE_LIMIT_API_KEY_PER_MINUTE,
    },
  };
}
