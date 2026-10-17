// Read-only mainnet check of a treasury address before it goes into core (D58):
//   node dist/check-treasury.js <treasury address> [mainnet RPC URL]
// It takes only a public address. It never asks for, reads or accepts a key.
import { MAINNET, type SolanaRpc } from "@m2m-monster/core";
import { createSolanaRpc, isAddress } from "@solana/kit";
import { checkTreasury, MAINNET_GENESIS } from "./treasury-check.js";

const [treasury, rpcUrl = "https://api.mainnet-beta.solana.com", ...rest] = process.argv.slice(2);

if (!treasury || rest.length > 0 || !isAddress(treasury)) {
  console.error(
    "Usage: node dist/check-treasury.js <treasury address> [mainnet RPC URL]\n" +
      "Pass only the public address (32-44 base58 characters). Never pass a key or a key file.",
  );
  process.exit(2);
}

const rpc = createSolanaRpc(rpcUrl) as unknown as SolanaRpc;
const genesis = await rpc.getGenesisHash().send();
if (genesis !== MAINNET_GENESIS) {
  console.error(`The RPC is not Solana mainnet (genesis ${genesis}).`);
  process.exit(1);
}

const results = await checkTreasury(rpc, MAINNET, treasury);
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.check}${r.detail ? `: ${r.detail}` : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed.` : "All checks passed.");
process.exit(failed ? 1 : 0);
