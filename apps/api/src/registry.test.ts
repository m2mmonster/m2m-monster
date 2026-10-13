import { describe, expect, it } from "vitest";
import { mcpManifest } from "./public.js";
import { REGISTRY_DESCRIPTION, serverJson } from "./registry.js";

describe("MCP Registry server.json", () => {
  const json = serverJson("https://sandbox.m2m.monster", "1.0.0", "m2m.monster (Devnet sandbox)");

  it("meets the registry limits", () => {
    expect(json.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(REGISTRY_DESCRIPTION.length).toBeLessThanOrEqual(100);
    expect(json.title.length).toBeLessThanOrEqual(100);
  });

  it("matches the published /.well-known/mcp.json", () => {
    const manifest = mcpManifest("https://sandbox.m2m.monster");
    expect(json.name).toBe(manifest.name);
    expect(json.$schema).toBe(manifest.$schema);
    expect(json.remotes[0]?.url).toBe(manifest.remotes[0]?.url);
  });

  it("never promotes USDT or claims custody", () => {
    expect(JSON.stringify(json)).not.toMatch(/usdt|custod(y|ial)(?! )|recover|reverse/i);
  });
});
