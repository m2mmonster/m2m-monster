// Devnet demo resource behind an m2m-split 402 (sections B, C, G, K, M; D48). Registered only on
// Devnet. The demo payee is a Devnet wallet whose key was discarded after creating its USDC
// account and registering it as an agent: the API knows only its address and nobody can move
// what it receives (worthless Devnet USDC).
import type { OpenAPIHono } from "@hono/zod-openapi";
import { DEVNET, NETWORKS } from "@m2m-monster/core";
import { createApiClient, createPaywall } from "@m2m-monster/sdk";
import { type AppDeps, externalRequest, inProcessFetch } from "./app.js";

export const DEMO_PAYEE = "9ENSDxrnoiXiut9pVzh1f6P3aYqjcoD7pRFE7foVCFqJ";

/** 0.01 Devnet USDC: fee 0.001 USDC, 0.009 USDC to the demo payee. */
export const DEMO_PRICE = { mint: NETWORKS[DEVNET].usdc, amount: "10000" };

export function registerDemoRoutes(app: OpenAPIHono, deps: AppDeps) {
  if (deps.network !== DEVNET) return;

  app.get("/demo", (c) => {
    const paywall = createPaywall({
      // In process, keeping the caller's connection for rate limits (like /mcp).
      api: createApiClient(deps.publicBaseUrl, {
        fetch: inProcessFetch(app, c),
      }),
      rpc: deps.rpc,
      network: DEVNET,
      payee: DEMO_PAYEE,
      now: deps.now,
    });
    return paywall.handle(
      externalRequest(c, deps.trustProxy),
      DEMO_PRICE,
      {
        description: "m2m.monster Devnet demo resource (0.01 Devnet USDC)",
        mimeType: "application/json",
      },
      async () =>
        Response.json({
          demo: true,
          network: DEVNET,
          message:
            "Paid with m2m-split on Solana Devnet. The receipt is in the PAYMENT-RESPONSE header.",
          docs: `${deps.publicBaseUrl}/llms.txt`,
        }),
    );
  });
}
