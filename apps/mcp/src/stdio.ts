#!/usr/bin/env node
// Local stdio MCP server. Configure with M2M_API_URL (default: production, https://api.m2m.monster;
// the Devnet sandbox is https://sandbox.m2m.monster, D40, D42) and the
// optional M2M_API_KEY from register_agent. It holds no agents' keys or funds and never signs or
// pays payment transactions.
import { readFileSync } from "node:fs";
import { createApiClient } from "@m2m-monster/sdk";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

// Report this package's own version in serverInfo (D42).
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const api = createApiClient(process.env.M2M_API_URL ?? "https://api.m2m.monster", {
  ...(process.env.M2M_API_KEY && { apiKey: process.env.M2M_API_KEY }),
});
await createMcpServer(api, version).connect(new StdioServerTransport());
