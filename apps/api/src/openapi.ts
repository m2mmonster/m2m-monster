// Writes spec/openapi.json from the route schemas. Run with `pnpm openapi`.
import { writeFileSync } from "node:fs";
import { DEVNET, NETWORKS, type SolanaRpc } from "@m2m-monster/core";
import { generateKeyPair } from "@solana/kit";
import { createApp } from "./app.js";
import { memoryKv } from "./kv.js";

const app = createApp({
  network: DEVNET,
  treasury: NETWORKS[DEVNET].treasury as string,
  serviceKeys: await generateKeyPair(),
  serviceAddress: "",
  kv: memoryKv(),
  // Generating the document never touches the database or the RPC.
  db: undefined as never,
  rpc: undefined as unknown as SolanaRpc,
  mintDecimals: async () => 6,
  now: Date.now,
  publicBaseUrl: "https://m2m.monster",
  clientIp: () => "",
  limits: { ip: 1, pubkey: 1, apiKey: 1 },
});

const doc = await (await app.request("/v1/openapi.json")).json();
writeFileSync(
  new URL("../../../spec/openapi.json", import.meta.url),
  `${JSON.stringify(doc, null, 2)}\n`,
);
