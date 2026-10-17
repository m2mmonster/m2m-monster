// m2m.monster MCP server (section L). A thin layer over the /v1 API: it holds no agents' keys
// or funds and never signs or pays payment transactions. Every tool that moves funds returns an unsigned transaction the agent signs
// locally (rule 4).
import { M2mError, type SignedQuote } from "@m2m-monster/core";
import type { ApiClient } from "@m2m-monster/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SERVER_NAME = "m2m-monster";
export const SERVER_VERSION = "1.1.0";

const Pubkey = z.string().min(32).max(44).describe("Base58 Solana public key");
const Units = z
  .string()
  .regex(/^\d{1,20}$/)
  .describe("Integer amount in base units of the mint");
const Quote = z
  .record(z.string(), z.unknown())
  .describe("The signed quote exactly as returned by quote_payment");
const Transaction = z.string().min(1).max(2048).describe("Base64 wire transaction");

const SIGN_LOCALLY =
  "Unsigned. Sign it locally with your own Solana key; m2m.monster never sees or uses agents' private keys.";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (data: unknown): Text => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** Runs a tool and turns failures into stable error codes with human-readable text. */
const tool =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<Text> => {
    try {
      return reply(await fn(args));
    } catch (error) {
      const e =
        error instanceof M2mError
          ? { code: error.code, message: error.message }
          : { code: "INTERNAL_ERROR", message: "Internal error. Retry later." };
      return { ...reply({ error: e }), isError: true };
    }
  };

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * `version` defaults to the hosted service version; the stdio package passes its own package
 * version (D42).
 */
export function createMcpServer(api: ApiClient, version: string = SERVER_VERSION): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });

  server.registerTool(
    "get_pricing",
    {
      description:
        "Agent-to-agent fee formula, referral program and the whitelisted token mints of this network.",
      annotations: readOnly,
    },
    tool(() => api.pricing()),
  );

  server.registerTool(
    "quote_payment",
    {
      description:
        "Price a payment to a payee: gross amount, net amount to the payee, fee_gross, discount, fee_net, treasury, mint and a 30-second expiry. Returns a signed quote.",
      inputSchema: {
        network: z
          .string()
          .describe("CAIP-2 network id, e.g. solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
        mint: Pubkey.describe("Payment token mint (exact whitelisted address)"),
        amount: Units,
        payee: Pubkey.describe("Wallet that receives the payment"),
        idempotency_key: z
          .string()
          .min(8)
          .max(128)
          .optional()
          .describe("Reuse the same key when retrying"),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    tool(({ network, mint, amount, payee, idempotency_key }) =>
      api.requestQuote(
        { network, mint, amount, payee },
        idempotency_key ?? `mcp-${crypto.randomUUID()}`,
      ),
    ),
  );

  server.registerTool(
    "build_payment",
    {
      description: `Build the m2m-split transaction for a quote: the payer's transfer to the payee and the USDC fee transfer to the treasury, in one atomic transaction where the payer pays its own gas. Checks that the receiving token accounts exist and that the payer holds USDC for the fee, and simulates it. ${SIGN_LOCALLY}`,
      inputSchema: {
        quote: Quote,
        payer: Pubkey.describe("The payer wallet; it signs and pays the network fee"),
        max_compute_unit_price: z
          .string()
          .regex(/^\d+$/)
          .optional()
          .describe("Lower priority fee cap in micro-lamports per compute unit"),
      },
      annotations: readOnly,
    },
    tool(async ({ quote, payer, max_compute_unit_price }) => ({
      ...(await api.buildPayment(
        quote as unknown as SignedQuote,
        payer,
        max_compute_unit_price === undefined ? undefined : BigInt(max_compute_unit_price),
      )),
      signing: SIGN_LOCALLY,
    })),
  );

  server.registerTool(
    "verify_payment",
    {
      description:
        "For the payee: check a payer-signed transaction against its quote (net amount, fee to the treasury, whitelisted mints, quote id and expiry) and simulate it before submitting.",
      inputSchema: { quote: Quote, transaction: Transaction },
      annotations: readOnly,
    },
    tool(({ quote, transaction }) =>
      api.verifyPayment(quote as unknown as SignedQuote, transaction),
    ),
  );

  server.registerTool(
    "submit_payment",
    {
      description:
        "Broadcast a transaction the payer already signed, wait for confirmation and return the signed receipt. Only broadcasts; never signs or pays payment transactions. A retry with the same idempotency_key never pays twice.",
      inputSchema: {
        quote: Quote,
        transaction: Transaction.describe("Base64 transaction signed by the payer"),
        idempotency_key: z.string().min(8).max(128),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    tool(({ quote, transaction, idempotency_key }) =>
      api.relayPayment(quote as unknown as SignedQuote, transaction, idempotency_key),
    ),
  );

  server.registerTool(
    "verify_receipt",
    {
      description:
        "Verify a receipt: the m2m.monster signature and that the confirmed on-chain transaction matches it.",
      inputSchema: { receipt: z.string().min(1).describe("Receipt JWS") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    tool(({ receipt }) => api.verifyReceipt(receipt)),
  );

  server.registerTool(
    "build_refund",
    {
      description: `Build a refund from the payee back to the payer, linked to the original receipt. The payee signs it and pays its gas; it has no m2m.monster fee and the original fee is not returned. ${SIGN_LOCALLY}`,
      inputSchema: {
        receipt: z.string().min(1).describe("Receipt JWS of the original payment"),
        amount: Units.describe("Refund amount, at most the original gross amount"),
      },
      annotations: readOnly,
    },
    tool(async ({ receipt, amount }) => ({
      ...(await api.buildRefund(receipt, amount)),
      signing: SIGN_LOCALLY,
    })),
  );

  server.registerTool(
    "register_agent",
    {
      description:
        "Optional registration; paying and getting paid work without it. It unlocks referral credits and receipt history. Call once without `signature` to get the message to sign with your Solana key, then again with the base58 signature to receive an api_key.",
      inputSchema: {
        solana_pubkey: Pubkey,
        agent_id: z.string().min(1).max(128).optional(),
        capabilities: z.array(z.string().max(64)).max(32).optional(),
        referred_by: Pubkey.optional().describe("Pubkey of the agent that referred you"),
        signature: z.string().optional().describe("Base58 ed25519 signature of the message"),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    tool(async ({ solana_pubkey, agent_id, capabilities, referred_by, signature }) => {
      if (!signature) {
        const challenge = await api.registrationChallenge(solana_pubkey);
        return {
          ...challenge,
          next_step:
            "Sign `message` (UTF-8 bytes) with the key of solana_pubkey and call register_agent again with the base58 signature before expires_at.",
        };
      }
      return api.registerSigned({
        agentId: agent_id ?? solana_pubkey,
        pubkey: solana_pubkey,
        signature,
        ...(capabilities && { capabilities }),
        ...(referred_by && { referredBy: referred_by }),
      });
    }),
  );

  server.registerTool(
    "get_referral_status",
    {
      description:
        "Your referrer, referred agents, credits and their expiry dates. Credits are discounts on your own fees, never cash. Requires the api_key from register_agent.",
      annotations: readOnly,
    },
    tool(() => api.referralStatus()),
  );

  server.registerTool(
    "get_status",
    { description: "Service status and API version.", annotations: readOnly },
    tool(() => api.status()),
  );

  return server;
}
