// Mint whitelists by exact address (section E). Mainnet and Devnet are never mixed.
// Decimals are read on-chain, never stored here.

export const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export type Network = typeof MAINNET | typeof DEVNET;

export interface AllowedMint {
  symbol: "USDC" | "USDT";
  mint: string;
}

export interface NetworkConfig {
  name: string;
  /** USDC mint: the only token the fee is paid in (rule 5). */
  usdc: string;
  /** Treasury wallet (cold multisig on mainnet, rule 9). Unset until the user provides it. */
  treasury?: string;
  mints: readonly AllowedMint[];
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  [MAINNET]: {
    name: "solana-mainnet",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    mints: [
      { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
    ],
  },
  // Decision D9: Devnet whitelist holds only Circle's Devnet USDC.
  [DEVNET]: {
    name: "solana-devnet",
    treasury: "DeQ2ZniNv2BiK746guCUz8tcxJ1HvmLW1e7EjjTiMFMj",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    mints: [{ symbol: "USDC", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }],
  },
};

export function isNetwork(value: string): value is Network {
  return Object.hasOwn(NETWORKS, value);
}

export function allowedMint(network: string, mint: string): AllowedMint | undefined {
  if (!isNetwork(network)) return undefined;
  return NETWORKS[network].mints.find((m) => m.mint === mint);
}
