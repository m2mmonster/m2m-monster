// Contract tests for every section L tool through the real /mcp endpoint (streamable HTTP).
import {
  associatedTokenAccount,
  DEVNET,
  NETWORKS,
  registrationMessage,
  signSplitTransaction,
} from "@m2m-monster/core";
import { type MockRpcState, putTokenAccount } from "@m2m-monster/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type Address,
  getBase58Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getUtf8Encoder,
  type KeyPairSigner,
  signBytes,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { signer, testApp } from "./test-app.js";

const USDC = NETWORKS[DEVNET].usdc as Address;
const TREASURY = NETWORKS[DEVNET].treasury as Address;

let app: Awaited<ReturnType<typeof testApp>>["app"];
let state: MockRpcState;
let payer: KeyPairSigner;
let payee: KeyPairSigner;

beforeEach(async () => {
  ({ app, state } = await testApp({ now: Date.now }));
  state.autoConfirm = true;
  payer = await signer(1);
  payee = await signer(2);
  for (const [owner, balance] of [
    [payer.address, 10_000_000n],
    [payee.address, 10_000_000n],
    [TREASURY, 0n],
  ] as const) {
    putTokenAccount(state, await associatedTokenAccount(owner, USDC), owner, USDC, balance);
  }
});

async function connect(apiKey?: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://m2m.monster/mcp"), {
      fetch: (url, init) => Promise.resolve(app.fetch(new Request(url, init))),
      ...(apiKey && { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } }),
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { body: JSON.parse(result.content[0]?.text ?? "null"), isError: !!result.isError };
}

const unsigned = (wire: string) =>
  Object.values(getTransactionDecoder().decode(getBase64Encoder().encode(wire)).signatures);

describe("MCP server (section L)", () => {
  it("exposes exactly the section L tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "build_payment",
        "build_refund",
        "get_pricing",
        "get_referral_status",
        "get_status",
        "quote_payment",
        "register_agent",
        "submit_payment",
        "verify_payment",
        "verify_receipt",
      ].sort(),
    );
    const text = JSON.stringify(tools);
    expect(text).not.toMatch(/swap|convert|buy usdt/i);
  });

  it("get_pricing and get_status", async () => {
    const client = await connect();
    expect((await call(client, "get_pricing")).body).toMatchObject({
      agent_to_agent: { min_fee_usd: "0.001", max_fee_usd: "0.5" },
    });
    expect((await call(client, "get_status")).body).toMatchObject({
      status: "ok",
      api_version: "v1",
    });
  });

  it("quote, build (unsigned), verify, submit, verify_receipt and build_refund (unsigned)", async () => {
    const client = await connect();
    const quote = (
      await call(client, "quote_payment", {
        network: DEVNET,
        mint: USDC,
        amount: "100000",
        payee: payee.address,
      })
    ).body;
    expect(quote).toMatchObject({ fee_gross: "1000", fee_net: "1000", payee_amount: "99000" });

    const built = await call(client, "build_payment", { quote, payer: payer.address });
    expect(built.isError).toBe(false);
    expect(unsigned(built.body.transaction)).toEqual([null]);
    expect(built.body.signing).toMatch(/Sign it locally/);

    // The agent signs locally; the MCP server never sees the key.
    const signed = await signSplitTransaction(built.body.transaction, payer.keyPair);
    expect(
      (await call(client, "verify_payment", { quote, transaction: signed })).body,
    ).toMatchObject({ valid: true, payer: payer.address });

    const settled = await call(client, "submit_payment", {
      quote,
      transaction: signed,
      idempotency_key: "mcp-pay-0001",
    });
    expect(settled.body.receipt_data).toMatchObject({ id: quote.id, fee_net: "1000" });

    const verified = await call(client, "verify_receipt", { receipt: settled.body.receipt });
    expect(verified.body).toMatchObject({ valid: true });

    const refund = await call(client, "build_refund", {
      receipt: settled.body.receipt,
      amount: "99000",
    });
    expect(unsigned(refund.body.transaction)).toEqual([null]);
  });

  it("returns stable error codes", async () => {
    const client = await connect();
    const below = await call(client, "quote_payment", {
      network: DEVNET,
      mint: USDC,
      amount: "999",
      payee: payee.address,
    });
    expect(below).toEqual({
      isError: true,
      body: { error: { code: "PAYMENT_BELOW_MINIMUM", message: expect.any(String) } },
    });
  });

  it("register_agent in two steps, then get_referral_status with the api_key", async () => {
    const client = await connect();
    const challenge = (await call(client, "register_agent", { solana_pubkey: payee.address })).body;
    expect(challenge.message).toBe(registrationMessage(payee.address, challenge.nonce));

    const signature = getBase58Decoder().decode(
      await signBytes(payee.keyPair.privateKey, getUtf8Encoder().encode(challenge.message)),
    );
    const registered = (
      await call(client, "register_agent", {
        solana_pubkey: payee.address,
        agent_id: "weather-agent",
        signature,
      })
    ).body;
    expect(registered.api_key).toMatch(/^m2m_/);

    const authed = await connect(registered.api_key);
    expect((await call(authed, "get_referral_status")).body).toMatchObject({
      referrer: null,
      available_credits: "0",
    });
    expect((await call(client, "get_referral_status")).body).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });
});
