// server.json for the official MCP Registry (registry.modelcontextprotocol.io), schema
// 2025-12-11 (checked 2026-10-11). Generated from code; published only with the user's approval.
import { writeFileSync } from "node:fs";

export const REGISTRY_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

/** At most 100 characters (registry limit). */
export const REGISTRY_DESCRIPTION =
  "Non-custodial x402 payments between AI agents on Solana. Returns unsigned transactions.";

/** `base` serves /mcp; `website` defaults to it (production: https://m2m.monster). */
export function serverJson(base: string, version: string, title = "m2m.monster", website = base) {
  return {
    $schema: REGISTRY_SCHEMA,
    name: "monster.m2m/m2m-monster",
    title,
    description: REGISTRY_DESCRIPTION,
    version,
    websiteUrl: website,
    remotes: [
      {
        type: "streamable-http",
        url: `${base}/mcp`,
        headers: [
          {
            name: "Authorization",
            description: "Optional. Bearer <api_key> from register_agent; unlocks referral status.",
            isRequired: false,
            isSecret: true,
          },
        ],
      },
    ],
  };
}

// node dist/registry.js <base-url> <version> [title] [website-url] > server.json
if (process.argv[1]?.endsWith("registry.js")) {
  const [base, version, title, website] = process.argv.slice(2);
  if (!base || !version)
    throw new Error("Usage: node dist/registry.js <base-url> <version> [title] [website-url]");
  const trim = (url: string) => url.replace(/\/$/, "");
  writeFileSync(
    1,
    `${JSON.stringify(serverJson(trim(base), version, title, website && trim(website)), null, 2)}\n`,
  );
}
