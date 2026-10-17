import { existsSync, readFileSync } from "node:fs";
import { associatedTokenAccount, DEVNET, MAINNET, NETWORKS } from "@m2m-monster/core";
import { address } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { terms, termsPage } from "./public.js";
import { TERMS_TEXT } from "./terms-text.js";
import { START, testApp } from "./test-app.js";

const REF = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";

// docs/ stays in the private repository (D39). There the checks compare with the approved file;
// in the public export they compare with the text generated from it.
const TERMS_FILE = new URL("../../../docs/terms-en.md", import.meta.url);
const approvedTerms = () =>
  existsSync(TERMS_FILE) ? readFileSync(TERMS_FILE, "utf8").replace(/\r\n/g, "\n") : TERMS_TEXT;

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
  "/terms",
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

  it("terms.json on Devnet keeps the section J draft unchanged", async () => {
    expect(await getJson("/terms.json")).toMatchObject({
      version: 1,
      status: "draft, pending legal review before mainnet",
    });
  });

  it("production terms.json is the approved docs/terms-en.md, without a draft mark (D56)", () => {
    const approved = approvedTerms();
    const prod = terms("https://m2m.monster", MAINNET);
    expect(prod).toEqual({
      title: "TERMS AND CONDITIONS OF USE OF THE M2M.MONSTER INFRASTRUCTURE",
      version: "2026-10-14",
      last_updated: "2026-10-14",
      language: "en",
      text: approved,
      pricing: "https://m2m.monster/pricing.json",
    });
    expect(prod).not.toHaveProperty("status");
    expect(JSON.stringify(prod)).not.toMatch(/\bdraft\b|pending legal review/i);
    expect(termsPage("https://m2m.monster", MAINNET)).toBe(approved);
  });

  it("/terms serves the content of terms.json as plain text (section J condition 6)", async () => {
    const res = await get("/terms");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const page = await res.text();
    const json = (await getJson("/terms.json")) as unknown as {
      status: string;
      statement: string;
      fee: string;
      commitments: string[];
      pricing: string;
    };
    for (const part of [json.status, json.statement, json.fee, json.pricing, ...json.commitments]) {
      expect(page).toContain(part);
    }
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

  it("agent docs explain retries: the SDK never pays twice, and the raw QUOTE_EXPIRED proof", async () => {
    const text = await (await get("/llms.txt")).text();
    expect(text).toContain("## Retries: never pay twice");
    expect(text).toContain("const outcome = paymentOutcome(res);");
    expect(text).toContain("PAYMENT_STATUS_UNKNOWN");
    expect(text).toContain("### Without the SDK");
    expect(text).toContain('`errorReason: "QUOTE_EXPIRED"`');
    expect(text).toContain("POST /v1/receipts/verify");
    expect(text).toContain("Pending payments live in memory only.");
    expect(text).toContain("getSignaturesForAddress");
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

describe("production deployment (m2m.monster and api.m2m.monster)", () => {
  const TREASURY = NETWORKS[MAINNET].treasury as string;
  const prodApp = async () =>
    (
      await testApp({
        network: MAINNET,
        treasury: TREASURY,
        publicBaseUrl: "https://m2m.monster",
        apiBaseUrl: "https://api.m2m.monster",
      })
    ).app;

  it("points /v1 and /mcp to API_BASE_URL and keeps public files and referrals on PUBLIC_BASE_URL", async () => {
    const prod = await prodApp();
    const json = async (path: string) => (await prod.request(path)).json() as Promise<never>;
    const mcp = (await json(`/.well-known/mcp.json?ref=${REF}`)) as Record<string, unknown>;
    expect(mcp).toMatchObject({
      websiteUrl: "https://m2m.monster",
      remotes: [{ type: "streamable-http", url: "https://api.m2m.monster/mcp" }],
      referral: { referred_by: REF },
    });
    const { links } = (await json("/discovery")) as { links: Record<string, string> };
    expect(links).toMatchObject({
      api: "https://api.m2m.monster/v1",
      openapi: "https://api.m2m.monster/v1/openapi.json",
      mcp: "https://api.m2m.monster/mcp",
      mcp_manifest: "https://m2m.monster/.well-known/mcp.json",
      pricing: "https://m2m.monster/pricing.json",
      terms: "https://m2m.monster/terms.json",
      terms_page: "https://m2m.monster/terms",
    });
    expect(links.demo).toBeUndefined();
    const openapi = (await json("/v1/openapi.json")) as { servers: { url: string }[] };
    expect(openapi.servers).toEqual([{ url: "https://api.m2m.monster" }]);
    const x402 = (await json("/.well-known/x402.json")) as Record<string, string>;
    expect(x402.quotes).toBe("https://api.m2m.monster/v1/quotes");
    const docs = await (await prod.request("/llms.txt")).text();
    expect(docs).toContain("curl -X POST https://api.m2m.monster/v1/quotes");
    expect(docs).toContain('createApiClient("https://api.m2m.monster")');
    expect(docs).not.toContain("Try it on Devnet");
  });

  it("publishes the mainnet treasury and exact mints from core, nothing written by hand", async () => {
    expect(TREASURY).toBe("D68nkVrQD3pcs6qNcadXqWvoKqsNCKpLemy3zYVmGHym");
    const prod = await prodApp();
    const x402 = (await (await prod.request("/.well-known/x402.json")).json()) as {
      schemes: { network: string; treasury: string; fee_asset: { mint: string } }[];
    };
    expect(x402.schemes[0]).toMatchObject({
      network: MAINNET,
      treasury: TREASURY,
      fee_asset: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    });
    const pricing = (await (await prod.request("/pricing.json")).json()) as {
      network: { id: string; tokens: { mint: string }[] };
    };
    expect(pricing.network.id).toBe(MAINNET);
    expect(pricing.network.tokens.map((t) => t.mint)).toEqual([
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    ]);
    const docs = await (await prod.request("/llms.txt")).text();
    expect(docs).toContain(`to the treasury \`${TREASURY}\``);
    for (const path of ALL) {
      const text = await (await prod.request(path)).text();
      expect(text, path).not.toContain(NETWORKS[DEVNET].treasury as string);
      expect(text, path).not.toContain(NETWORKS[DEVNET].usdc);
    }
  });

  it("the OpenAPI examples come from the deployment's network (core)", async () => {
    const example = async (app: Awaited<ReturnType<typeof prodApp>>) => {
      const doc = (await (await app.request("/v1/openapi.json")).json()) as {
        components: {
          schemas: { QuoteRequest: { properties: Record<string, { example?: string }> } };
        };
      };
      const { network, mint } = doc.components.schemas.QuoteRequest.properties;
      return { network: network?.example, mint: mint?.example };
    };
    expect(await example(await prodApp())).toEqual({
      network: MAINNET,
      mint: NETWORKS[MAINNET].usdc,
    });
    expect(await example(app)).toEqual({ network: DEVNET, mint: NETWORKS[DEVNET].usdc });
  });

  it("the mainnet treasury's USDC account is the classic SPL Token ATA", async () => {
    expect(await associatedTokenAccount(address(TREASURY), address(NETWORKS[MAINNET].usdc))).toBe(
      "EWQ5w4DPmkinV4iHn9H7pcwx5Q8fYQCnY46CzGD1ErTk",
    );
  });

  it("serves the approved terms on /terms and never http:// URLs", async () => {
    const prod = await prodApp();
    const approved = approvedTerms();
    expect(await (await prod.request("/terms")).text()).toBe(approved);
    for (const path of [...ALL, "/.well-known/security.txt"]) {
      const res = await prod.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).not.toContain("http://");
    }
  });

  it("serves security.txt with GitHub private reporting as the only contact (D45, D62)", async () => {
    const res = await (await prodApp()).request("/.well-known/security.txt");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    const fields = Object.fromEntries(
      text
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
    );
    expect(fields).toMatchObject({
      Contact: "https://github.com/m2mmonster/m2m-monster/security/advisories/new",
      Canonical: "https://m2m.monster/.well-known/security.txt",
      "Preferred-Languages": "en",
    });
    expect(text.match(/^Contact:/gm)).toHaveLength(1);
    expect(text).not.toMatch(/@|mailto/i);
    const expires = Date.parse(fields.Expires as string);
    expect(expires).toBeGreaterThan(START);
    expect(expires - START).toBeLessThan(365 * 24 * 60 * 60 * 1000);
  });

  it("does not serve security.txt on the Devnet sandbox", async () => {
    expect((await app.request("/.well-known/security.txt")).status).toBe(404);
  });
});
