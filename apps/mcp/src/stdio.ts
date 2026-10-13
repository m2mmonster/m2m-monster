#!/usr/bin/env node
// Local stdio MCP server. Configure with M2M_API_URL (0.x beta default: the Devnet sandbox) and the
// optional M2M_API_KEY from register_agent. It holds no keys and never signs.
import { createApiClient } from "@m2m-monster/sdk";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

const api = createApiClient(process.env.M2M_API_URL ?? "https://sandbox.m2m.monster", {
  ...(process.env.M2M_API_KEY && { apiKey: process.env.M2M_API_KEY }),
});
await createMcpServer(api).connect(new StdioServerTransport());
