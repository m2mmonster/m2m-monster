import { DEVNET, NETWORKS } from "@m2m-monster/core";
import { beforeEach, describe, expect, it } from "vitest";
import { testApp } from "./test-app.js";

const REF = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";

let app: Awaited<ReturnType<typeof testApp>>["app"];

beforeEach(async () => {
  ({ app } = await testApp());
});

const get = async (path: string) => {
  const res = await app.request(path);
  expect(res.status, path).toBe(200);
  return res;
};
const getJson = async (path: string) =>
  (await (await get(path)).json()) as Record<string, unknown> & { [k: string]: never };

const ALL = [
  "/.well-known/mcp.json",
  "/.well-known/agent-card.json",
  "/.well-known/x402.json",
  "/pricing.json",
  "/capabilities.json",
  "/terms.json",
  "/status.json",
  "/discovery",
  "/v1/openapi.json",
  "/v1/errors",
  "/llms.txt",
];

describe("discoverability files (section B)", () => {
  it("serves every file", async () => {
    for (const path of ALL) await get(path);
  });

  it("mcp.json describes the MCP server and carries ?ref as referral (section C)", async () => {
    const plain = await getJson("/.well-known/mcp.json");
    expect(plain).toMatchObject({
      name: "monster.m2m/m2m-monster",
      remotes: [{ type: "streamable-http", url: "https://m2m.monster/mcp" }],
    });
    expect(plain.referral).toBeUndefined();
    const referred = await getJson(`/.well-known/mcp.json?ref=${REF}`);
    expect(referred.referral).toMatchObject({ referred_by: REF });
    const invalid = await getJson("/.well-known/mcp.json?ref=not-a-key");
    expect(invalid.referral).toBeUndefined();
  });

  it("agent-card.json has the A2A v1.0 required fields", async () => {
    const card = await getJson("/.well-known/agent-card.json");
    for (const field of [
      "name",
      "description",
      "supportedInterfaces",
      "version",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "skills",
    ]) {
      expect(card, field).toHaveProperty(field);
    }
    expect((card.skills as { id: string }[]).map((s) => s.id)).toContain("quote_payment");
  });

  it("x402.json describes the m2m-split scheme with exact mints", async () => {
    const x402 = await getJson("/.well-known/x402.json");
    expect(x402).toMatchObject({
      x402Version: 2,
      schemes: [
        {
          scheme: "m2m-split",
          network: DEVNET,
          assets: NETWORKS[DEVNET].mints,
          fee_asset: { symbol: "USDC", mint: NETWORKS[DEVNET].usdc },
          payment_flow: "upfront",
        },
      ],
    });
  });

  it("capabilities.json lists only what works today (D13)", async () => {
    const text = JSON.stringify(await getJson("/capabilities.json"));
    expect(text).toMatch(/verifiable_receipts/);
    expect(text).toMatch(/refund_tooling/);
    expect(text).not.toMatch(/AP2|mandate|spending|invoic|planned|EURC|Base/i);
  });

  it("terms.json carries the section J statements", async () => {
    const terms = await getJson("/terms.json");
    expect(terms.statement).toBe(
      "Non-custodial software provider, not a payment intermediary, not a CASP, does not hold means of access.",
    );
    const text = JSON.stringify(terms);
    expect(text).toMatch(/software usage license/);
    expect(text).toMatch(/never sponsors|does not sponsor/i);
  });

  it("status.json announces the API version", async () => {
    expect(await getJson("/status.json")).toMatchObject({ api_version: "v1", deprecations: [] });
  });

  it("discovery links every public resource", async () => {
    const discovery = await getJson("/discovery");
    const links = Object.values(discovery.links as Record<string, string>);
    for (const path of ALL.filter((p) => p !== "/discovery")) {
      expect(links).toContain(`https://m2m.monster${path}`);
    }
  });

  it("serves the icon", async () => {
    const res = await get("/icon.svg");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toMatch(/^<svg /);
  });

  it("agent docs are copy-ready and use the enforced values", async () => {
    const text = await (await get("/llms.txt")).text();
    expect(text).toContain("min(max(0.25% × amount, $0.001), $0.5)");
    expect(text).toContain("curl");
    expect(text).toContain("createPaymentFetch");
    expect(text).toContain(NETWORKS[DEVNET].usdc);
  });

  it("points to the Devnet demo resource", async () => {
    const text = await (await get("/llms.txt")).text();
    expect(text).toContain("## Try it on Devnet");
    expect(text).toContain("https://m2m.monster/demo");
    const discovery = await getJson("/discovery");
    expect((discovery.links as Record<string, string>).demo).toBe("https://m2m.monster/demo");
  });

  it("never generates http:// URLs (PUBLIC_BASE_URL is https)", async () => {
    for (const path of ALL) {
      const text = await (await get(path)).text();
      expect(text, path).not.toContain("http://");
    }
  });

  it("never links to buying USDT or promotes it (rule 6)", async () => {
    for (const path of ALL) {
      const text = await (await get(path)).text();
      expect(text, path).not.toMatch(/buy usdt|get usdt|purchase|exchange usdt|swap/i);
    }
  });
});
