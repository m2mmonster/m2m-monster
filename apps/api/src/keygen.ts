// Generates a new service key (signs quotes and receipts; never holds funds, D7).
// Prints SERVICE_KEY for the deployment's environment variables and its public address.
import type { KeyPair } from "@m2m-monster/core";
import { getBase58Decoder } from "@solana/kit";

const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as KeyPair;
const seed = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(-32);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b58 = getBase58Decoder();
console.log(`SERVICE_KEY=${b58.decode(new Uint8Array([...seed, ...pub]))}`);
console.error(`Service address: ${b58.decode(pub)} (never send funds to it)`);
