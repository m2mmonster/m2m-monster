// Test wiring for the API: mock RPC, PGlite, in-memory KV and a controllable clock. Tests only.
import {
  buildSplitTransaction,
  DEVNET,
  NETWORKS,
  type SignedQuote,
  type SplitParams,
  signSplitTransaction,
  splitExpectation,
} from "@m2m-monster/core";
import { mockRpc } from "@m2m-monster/core/testing";
import {
  blockhash,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressFromPublicKey,
  type KeyPairSigner,
} from "@solana/kit";
import { type AppDeps, createApp } from "./app.js";
import { memoryKv } from "./kv.js";
import { testDb } from "./test-db.js";

export const START = 1_791_460_000_000;

export async function testApp(overrides: Partial<AppDeps> = {}) {
  const clock = { now: START };
  const { rpc, state } = mockRpc();
  const serviceKeys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(9), true);
  const deps: AppDeps = {
    network: DEVNET,
    treasury: NETWORKS[DEVNET].treasury as string,
    serviceKeys,
    serviceAddress: await getAddressFromPublicKey(serviceKeys.publicKey),
    kv: memoryKv(() => clock.now),
    db: await testDb(),
    rpc,
    mintDecimals: async () => 6,
    now: () => clock.now,
    publicBaseUrl: "https://m2m.monster",
    clientIp: () => "203.0.113.7",
    limits: { ip: 1000, pubkey: 1000, apiKey: 1000 },
    ...overrides,
  };
  return { app: createApp(deps), deps, state, clock };
}

export const signer = (seed: number) =>
  createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** The payer's side, as the SDK does it: build and sign the m2m-split for a quote. */
export async function payerTransaction(
  quote: SignedQuote,
  payer: KeyPairSigner,
  changes: Partial<SplitParams> = {},
) {
  const unsigned = await buildSplitTransaction({
    ...splitExpectation(quote),
    payer: payer.address,
    computeUnitLimit: 20_000,
    computeUnitPrice: 0n,
    lifetime: {
      blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"),
      lastValidBlockHeight: 1_000n,
    },
    ...changes,
  });
  return { unsigned, signed: await signSplitTransaction(unsigned, payer.keyPair) };
}
