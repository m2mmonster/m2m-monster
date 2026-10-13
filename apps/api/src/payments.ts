// Relay and receipts (sections G, K, L; decisions D8, D14).
// The relay only broadcasts transactions the payer already signed; it never signs or pays.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  assertQuoteValid,
  fetchConfirmedTransaction,
  M2mError,
  type Receipt,
  receiptFromQuote,
  type SignedQuote,
  signReceipt,
  simulate,
  splitExpectation,
  submitAndConfirm,
  verifyQuote,
  verifyReceipt,
  verifySplitTransaction,
} from "@m2m-monster/core";
import { eq } from "drizzle-orm";
import { recordSettlement } from "./agents.js";
import type { AppDeps, Helpers } from "./app.js";
import { SignedQuoteSchema } from "./quotes.js";
import { receipts } from "./schema.js";
import { BaseUnits, errorResponses, Pubkey } from "./schemas.js";

const DAY = 24 * 60 * 60 * 1000;

const WireTransaction = z
  .string()
  .min(1)
  .max(2048)
  .openapi({ description: "Base64 wire transaction signed by the payer" });

const ReceiptData = z
  .object({
    version: z.literal(1),
    id: z.string(),
    network: z.string(),
    transaction: z.string(),
    payer: Pubkey,
    payee: Pubkey,
    mint: Pubkey,
    decimals: z.number().int(),
    amount: BaseUnits,
    payee_amount: BaseUnits,
    usdc_mint: Pubkey,
    usdc_decimals: z.number().int(),
    treasury: Pubkey,
    fee_gross: BaseUnits,
    discount: BaseUnits,
    fee_net: BaseUnits,
    issued_at: z.number().int(),
    referral: z.string(),
  })
  .openapi("ReceiptData");

const Settlement = z
  .object({
    signature: z.string().openapi({ description: "Base58 transaction signature" }),
    receipt: z.string().openapi({ description: "Compact JWS (EdDSA) signed by the service key" }),
    receipt_data: ReceiptData,
  })
  .openapi("Settlement");

const created = {
  201: {
    description: "Settled payment and its signed receipt",
    content: { "application/json": { schema: Settlement } },
  },
};

const paymentRoute = createRoute({
  method: "post",
  path: "/v1/payments",
  summary:
    "Relay: verify and broadcast a payment already signed by the payer, and return its receipt",
  request: {
    headers: z.object({ "idempotency-key": z.string().min(8).max(128) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ quote: SignedQuoteSchema, transaction: WireTransaction }),
        },
      },
      required: true,
    },
  },
  responses: { ...created, ...errorResponses(400, 409, 410, 429, 500) },
});

const reportRoute = createRoute({
  method: "post",
  path: "/v1/receipts",
  summary: "Get a receipt for a payment the payee broadcast itself, once confirmed on-chain",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ quote: SignedQuoteSchema, signature: z.string().min(32).max(128) }),
        },
      },
      required: true,
    },
  },
  responses: { ...created, ...errorResponses(400, 404, 410, 429, 500) },
});

const getReceiptRoute = createRoute({
  method: "get",
  path: "/v1/receipts/{id}",
  summary: "Get a receipt by id (the quote id)",
  request: { params: z.object({ id: z.string().min(1).max(64) }) },
  responses: {
    200: {
      description: "Receipt",
      content: { "application/json": { schema: Settlement } },
    },
    ...errorResponses(404, 429, 500),
  },
});

const verifyReceiptRoute = createRoute({
  method: "post",
  path: "/v1/receipts/verify",
  summary: "Verify a receipt: service signature and the matching transaction on-chain",
  request: {
    body: {
      content: { "application/json": { schema: z.object({ receipt: z.string().min(1) }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The receipt is valid",
      content: {
        "application/json": {
          schema: z.object({ valid: z.literal(true), receipt_data: ReceiptData, slot: z.string() }),
        },
      },
    },
    ...errorResponses(400, 429, 500),
  },
});

const payloadOf = (jws: string) =>
  JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString()) as Receipt;

const settlement = (row: { transaction: string; jws: string }) => ({
  signature: row.transaction,
  receipt: row.jws,
  receipt_data: payloadOf(row.jws),
});

export function registerPaymentRoutes(app: OpenAPIHono, deps: AppDeps, helpers: Helpers) {
  const nowSeconds = () => Math.floor(deps.now() / 1000);

  const checkNetwork = (quote: SignedQuote) => {
    if (quote.network !== deps.network) {
      throw new M2mError("INVALID_REQUEST", `This deployment serves ${deps.network} only.`);
    }
  };

  /** Stores one receipt per quote. A quote settled by another transaction is already used. */
  async function issueReceipt(
    quote: SignedQuote,
    payer: string,
    signature: string,
    source: "relay" | "report",
  ) {
    const receipt = receiptFromQuote(quote, {
      payer,
      transaction: signature,
      issuedAt: nowSeconds(),
    });
    const jws = await signReceipt(receipt, deps.serviceKeys.privateKey, deps.serviceAddress);
    await deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(receipts)
        .values({
          id: receipt.id,
          network: receipt.network,
          transaction: receipt.transaction,
          payer: receipt.payer,
          payee: receipt.payee,
          mint: receipt.mint,
          amount: receipt.amount,
          payeeAmount: receipt.payee_amount,
          feeGross: receipt.fee_gross,
          discount: receipt.discount,
          feeNet: receipt.fee_net,
          issuedAt: new Date(receipt.issued_at * 1000),
          source,
          jws,
        })
        .onConflictDoNothing()
        .returning({ id: receipts.id });
      // Referral bookkeeping runs once, with the receipt (section C).
      if (inserted.length) await recordSettlement(tx, receipt);
    });
    const [row] = await deps.db.select().from(receipts).where(eq(receipts.id, quote.id));
    if (!row || row.transaction !== signature) {
      throw new M2mError("QUOTE_EXPIRED", "This quote was already settled by another transaction.");
    }
    return settlement(row);
  }

  app.openapi(paymentRoute, async (c) => {
    const { quote, transaction } = c.req.valid("json") as {
      quote: SignedQuote;
      transaction: string;
    };
    const { "idempotency-key": idempotencyKey } = c.req.valid("header");
    const result = await helpers.idempotent(
      "payment",
      idempotencyKey,
      `${quote.id}:${transaction}`,
      async () => {
        checkNetwork(quote);
        await helpers.limit("pubkey", quote.payee, deps.limits.pubkey);
        await assertQuoteValid(quote, deps.serviceAddress, nowSeconds());
        const verified = await verifySplitTransaction(transaction, splitExpectation(quote), {
          signed: true,
        });

        // A signed payload is valid only once and only for its quote (section K).
        const marker = helpers.sha256(idempotencyKey);
        const usedKey = `used:quote:${quote.id}`;
        if (
          !(await deps.kv.setIfAbsent(usedKey, marker, DAY)) &&
          (await deps.kv.get(usedKey)) !== marker
        ) {
          throw new M2mError("QUOTE_EXPIRED", "This quote was already used.");
        }

        await simulate(deps.rpc, transaction, { sigVerify: true });
        const signature = await submitAndConfirm(deps.rpc, transaction);
        return issueReceipt(quote, verified.payer, signature, "relay");
      },
    );
    return c.json(result, 201);
  });

  app.openapi(reportRoute, async (c) => {
    const { quote, signature } = c.req.valid("json") as { quote: SignedQuote; signature: string };
    checkNetwork(quote);
    if (!(await verifyQuote(quote, deps.serviceAddress))) throw new M2mError("QUOTE_INVALID");

    const [existing] = await deps.db.select().from(receipts).where(eq(receipts.id, quote.id));
    if (existing) {
      if (existing.transaction !== signature) {
        throw new M2mError(
          "QUOTE_EXPIRED",
          "This quote was already settled by another transaction.",
        );
      }
      return c.json(settlement(existing), 201);
    }

    const confirmed = await fetchConfirmedTransaction(deps.rpc, signature);
    if (!confirmed) {
      throw new M2mError("NOT_FOUND", "The transaction is not confirmed on-chain yet.");
    }
    const verified = await verifySplitTransaction(confirmed.wire, splitExpectation(quote), {
      signed: true,
    });
    if (verified.signature !== signature) {
      throw new M2mError("PAYMENT_TRANSACTION_INVALID", "The signature does not match.");
    }
    return c.json(await issueReceipt(quote, verified.payer, signature, "report"), 201);
  });

  app.openapi(getReceiptRoute, async (c) => {
    const [row] = await deps.db
      .select()
      .from(receipts)
      .where(eq(receipts.id, c.req.valid("param").id));
    if (!row) throw new M2mError("NOT_FOUND", "No receipt with this id.");
    return c.json(settlement(row), 200);
  });

  app.openapi(verifyReceiptRoute, async (c) => {
    const { receipt, slot } = await verifyReceipt(
      deps.rpc,
      c.req.valid("json").receipt,
      deps.serviceAddress,
    );
    return c.json({ valid: true as const, receipt_data: receipt, slot: `${slot}` }, 200);
  });
}
