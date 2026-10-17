import { readFileSync } from "node:fs";
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

  it("the mainnet entry: 1.1.0, /mcp on api.m2m.monster, website m2m.monster, no sandbox title", () => {
    const mainnet = serverJson(
      "https://api.m2m.monster",
      "1.1.0",
      "m2m.monster",
      "https://m2m.monster",
    );
    expect(mainnet).toMatchObject({
      version: "1.1.0",
      title: "m2m.monster",
      websiteUrl: "https://m2m.monster",
      remotes: [{ type: "streamable-http", url: "https://api.m2m.monster/mcp" }],
    });
    expect(
      mcpManifest("https://m2m.monster", undefined, "https://api.m2m.monster").remotes,
    ).toEqual(mainnet.remotes.map(({ type, url }) => ({ type, url })));
    expect(JSON.stringify(mainnet)).not.toMatch(/sandbox|devnet/i);
  });

  it("deploy/registry/server.mainnet.json is the generated mainnet entry", () => {
    const file = JSON.parse(
      readFileSync(
        new URL("../../../deploy/registry/server.mainnet.json", import.meta.url),
        "utf8",
      ),
    );
    expect(file).toEqual(
      serverJson("https://api.m2m.monster", "1.1.0", "m2m.monster", "https://m2m.monster"),
    );
  });

  it("never promotes USDT or claims custody", () => {
    expect(JSON.stringify(json)).not.toMatch(/usdt|custod(y|ial)(?! )|recover|reverse/i);
  });
});
