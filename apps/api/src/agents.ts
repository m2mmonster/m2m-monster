// Registration (section D) and the referral program (section C; decisions D2–D6, D33).
import { createHash, randomBytes } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  activationReached,
  creditAccrualOpen,
  creditExpiry,
  M2mError,
  type Receipt,
  referralCredit,
  referredDiscountActive,
  registrationMessage,
  usdUnits,
} from "@m2m-monster/core";
import {
  type Address,
  getBase58Decoder,
  getBase58Encoder,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  type SignatureBytes,
  verifySignature,
} from "@solana/kit";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDeps } from "./app.js";
import type { Db } from "./db.js";
import { agents, creditReservations, credits, receipts } from "./schema.js";
import { errorResponses, Pubkey } from "./schemas.js";

type Agent = typeof agents.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Reserved credits outlive the 30 s quote by the blockhash lifetime (D6, D33). */
const RESERVATION_GRACE_MS = 120 * 1000;

const hashKey = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex");
const seconds = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);

/** The agent behind `Authorization: Bearer <api_key>`, or undefined without the header. */
export async function authenticatedAgent(deps: AppDeps, c: Context): Promise<Agent | undefined> {
  const header = c.req.header("authorization");
  if (!header) return undefined;
  const apiKey = header.replace(/^Bearer\s+/i, "");
  const [agent] = await deps.db
    .select()
    .from(agents)
    .where(eq(agents.apiKeyHash, hashKey(apiKey)));
  if (!agent) throw new M2mError("UNAUTHORIZED");
  return agent;
}

async function requireAgent(deps: AppDeps, c: Context): Promise<Agent> {
  const agent = await authenticatedAgent(deps, c);
  if (!agent) throw new M2mError("UNAUTHORIZED");
  return agent;
}

/** Credits not expired, minus those held by open quotes. */
async function availableCredits(db: Db | Tx, pubkey: string, now: Date): Promise<bigint> {
  const [{ total } = { total: "0" }] = await db
    .select({ total: sql<string>`coalesce(sum(${credits.remaining}), 0)` })
    .from(credits)
    .where(and(eq(credits.referrer, pubkey), gt(credits.expiresAt, now)));
  const [{ held } = { held: "0" }] = await db
    .select({ held: sql<string>`coalesce(sum(${creditReservations.amount}), 0)` })
    .from(creditReservations)
    .where(and(eq(creditReservations.agent, pubkey), gt(creditReservations.expiresAt, now)));
  const available = BigInt(total) - BigInt(held);
  return available > 0n ? available : 0n;
}

/**
 * Prices a quote for an authenticated payee with its discounts and reserves the credits it
 * uses (D6). Discounts only apply when the payee itself requests the quote (D33).
 */
export async function withDiscounts<T>(
  deps: AppDeps,
  payee: Agent | undefined,
  quoteId: string,
  expiresAt: number,
  price: (discounts: {
    referred: boolean;
    credits: bigint;
  }) => Promise<T & { creditsUsed: bigint }>,
): Promise<T & { creditsUsed: bigint }> {
  if (!payee) return price({ referred: false, credits: 0n });
  const now = new Date(deps.now());
  return deps.db.transaction(async (tx) => {
    await tx.select().from(agents).where(eq(agents.pubkey, payee.pubkey)).for("update");
    const result = await price({
      referred: !!payee.referredBy && referredDiscountActive(payee.firstSettlementAt, now),
      credits: await availableCredits(tx, payee.pubkey, now),
    });
    if (result.creditsUsed > 0n) {
      await tx.insert(creditReservations).values({
        quoteId,
        agent: payee.pubkey,
        amount: `${result.creditsUsed}`,
        expiresAt: new Date(expiresAt * 1000 + RESERVATION_GRACE_MS),
      });
    }
    return result;
  });
}

/** Spends `amount` of the agent's credits, earliest expiry first. */
async function spendCredits(tx: Tx, pubkey: string, amount: bigint, now: Date) {
  let left = amount;
  const rows = await tx
    .select()
    .from(credits)
    .where(
      and(eq(credits.referrer, pubkey), gt(credits.expiresAt, now), gt(credits.remaining, "0")),
    )
    .orderBy(credits.expiresAt)
    .for("update");
  for (const row of rows) {
    if (left === 0n) break;
    const take = BigInt(row.remaining) < left ? BigInt(row.remaining) : left;
    await tx
      .update(credits)
      .set({ remaining: `${BigInt(row.remaining) - take}` })
      .where(eq(credits.id, row.id));
    left -= take;
  }
}

/**
 * Referral bookkeeping for a newly stored receipt, in the same transaction (section C):
 * first settlement, payee activation, credit spending and credit accrual for the referrer.
 */
export async function recordSettlement(tx: Tx, receipt: Receipt) {
  const now = new Date(receipt.issued_at * 1000);
  await tx
    .update(agents)
    .set({ firstSettlementAt: now })
    .where(
      and(inArray(agents.pubkey, [receipt.payer, receipt.payee]), isNull(agents.firstSettlementAt)),
    );

  const [reservation] = await tx
    .delete(creditReservations)
    .where(eq(creditReservations.quoteId, receipt.id))
    .returning();

  const [payee] = await tx
    .select()
    .from(agents)
    .where(eq(agents.pubkey, receipt.payee))
    .for("update");
  if (!payee) return;

  if (reservation) await spendCredits(tx, payee.pubkey, BigInt(reservation.amount), now);

  const settlements = payee.settlementsAsPayee + 1;
  const volume = BigInt(payee.volumeAsPayee) + usdUnits(BigInt(receipt.amount), receipt.decimals);
  const activatedAt = payee.activatedAt ?? (activationReached(settlements, volume) ? now : null);
  await tx
    .update(agents)
    .set({ settlementsAsPayee: settlements, volumeAsPayee: `${volume}`, activatedAt })
    .where(eq(agents.pubkey, payee.pubkey));

  // Credits accrue only from fees paid after activation, for 12 months (D5).
  if (payee.referredBy && creditAccrualOpen(payee.activatedAt, now)) {
    const credit = referralCredit(BigInt(receipt.fee_net));
    if (credit > 0n) {
      await tx.insert(credits).values({
        id: receipt.id,
        referrer: payee.referredBy,
        referred: payee.pubkey,
        amount: `${credit}`,
        remaining: `${credit}`,
        accruedAt: now,
        expiresAt: creditExpiry(now),
      });
    }
  }
}

const challengeRoute = createRoute({
  method: "post",
  path: "/v1/agents/challenge",
  summary: "Start optional registration: get a nonce to sign with the agent's Solana key",
  request: {
    body: {
      content: { "application/json": { schema: z.object({ solana_pubkey: Pubkey }) } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        "Challenge. Sign `m2m.monster registration\\npubkey: <pubkey>\\nnonce: <nonce>`.",
      content: {
        "application/json": {
          schema: z.object({ nonce: z.string(), expires_at: z.number().int() }),
        },
      },
    },
    ...errorResponses(400, 429, 500),
  },
});

const registerRoute = createRoute({
  method: "post",
  path: "/v1/agents/register",
  summary:
    "Register with a signed challenge. Unlocks referrals and receipt history; not needed to pay or get paid.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            agent_id: z.string().min(1).max(128),
            solana_pubkey: Pubkey,
            capabilities: z.array(z.string().max(64)).max(32).default([]),
            referred_by: Pubkey.optional(),
            signature: z.string().openapi({ description: "Base58 ed25519 signature" }),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Registered. The api_key is shown once; it only authenticates API calls.",
      content: {
        "application/json": {
          schema: z.object({
            api_key: z.string(),
            mcp: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) }),
          }),
        },
      },
    },
    ...errorResponses(400, 429, 500),
  },
});

const bearer = { security: [{ apiKey: [] }] };

const referralsRoute = createRoute({
  method: "get",
  path: "/v1/agents/me/referrals",
  summary: "Referrer, referred agents, credits and expiry dates (get_referral_status)",
  ...bearer,
  responses: {
    200: {
      description: "Referral status. Credits are discounts on own fees, never cash.",
      content: {
        "application/json": {
          schema: z.object({
            referrer: z.string().nullable(),
            referral_link: z.string(),
            referred_discount_until: z.number().int().nullable(),
            referred: z.array(
              z.object({
                pubkey: z.string(),
                registered_at: z.number().int(),
                activated_at: z.number().int().nullable(),
              }),
            ),
            credits: z.array(
              z.object({
                amount: z.string(),
                remaining: z.string(),
                accrued_at: z.number().int(),
                expires_at: z.number().int(),
              }),
            ),
            available_credits: z.string(),
          }),
        },
      },
    },
    ...errorResponses(401, 429, 500),
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/v1/agents/me/receipts",
  summary: "Receipt history of the authenticated agent, as payer or payee, newest first",
  ...bearer,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      before: z.coerce.number().int().optional().openapi({ description: "Unix seconds" }),
    }),
  },
  responses: {
    200: {
      description: "Receipts",
      content: {
        "application/json": {
          schema: z.object({
            receipts: z.array(
              z.object({ signature: z.string(), receipt: z.string(), receipt_data: z.any() }),
            ),
          }),
        },
      },
    },
    ...errorResponses(401, 429, 500),
  },
});

export function registerAgentRoutes(app: OpenAPIHono, deps: AppDeps) {
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
    type: "http",
    scheme: "bearer",
  });

  app.openapi(challengeRoute, async (c) => {
    const { solana_pubkey } = c.req.valid("json");
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = deps.now() + CHALLENGE_TTL_MS;
    // The latest challenge per pubkey is the one that counts.
    await deps.kv.set(
      `challenge:${solana_pubkey}`,
      JSON.stringify({ nonce, expiresAt }),
      CHALLENGE_TTL_MS,
    );
    return c.json({ nonce, expires_at: Math.floor(expiresAt / 1000) }, 201);
  });

  app.openapi(registerRoute, async (c) => {
    const body = c.req.valid("json");
    await consumeChallenge(deps, body.solana_pubkey, body.signature);

    if (body.referred_by === body.solana_pubkey) {
      throw new M2mError("INVALID_REQUEST", "An agent cannot refer itself.");
    }
    const apiKey = `m2m_${getBase58Decoder().decode(randomBytes(32))}`;
    const now = new Date(deps.now());

    await deps.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(agents)
        .where(eq(agents.pubkey, body.solana_pubkey))
        .for("update");
      if (body.referred_by) {
        if (existing && existing.referredBy !== body.referred_by) {
          throw new M2mError("INVALID_REQUEST", "The referrer is permanent and cannot change.");
        }
        const [referrer] = await tx
          .select()
          .from(agents)
          .where(eq(agents.pubkey, body.referred_by));
        if (!referrer)
          throw new M2mError("INVALID_REQUEST", "referred_by is not a registered agent.");
      }
      if (existing) {
        await tx
          .update(agents)
          .set({
            apiKeyHash: hashKey(apiKey),
            agentId: body.agent_id,
            capabilities: body.capabilities,
          })
          .where(eq(agents.pubkey, existing.pubkey));
      } else {
        await tx.insert(agents).values({
          pubkey: body.solana_pubkey,
          agentId: body.agent_id,
          capabilities: body.capabilities,
          referredBy: body.referred_by ?? null,
          apiKeyHash: hashKey(apiKey),
          registeredAt: now,
        });
      }
    });

    return c.json(
      {
        api_key: apiKey,
        mcp: { url: `${deps.publicBaseUrl}/mcp`, headers: { Authorization: `Bearer ${apiKey}` } },
      },
      201,
    );
  });

  app.openapi(referralsRoute, async (c) => {
    const agent = await requireAgent(deps, c);
    const now = new Date(deps.now());
    const referred = await deps.db
      .select()
      .from(agents)
      .where(eq(agents.referredBy, agent.pubkey))
      .orderBy(agents.registeredAt);
    const own = await deps.db
      .select()
      .from(credits)
      .where(eq(credits.referrer, agent.pubkey))
      .orderBy(credits.accruedAt);
    const discountUntil =
      agent.referredBy && agent.firstSettlementAt
        ? agent.firstSettlementAt.getTime() / 1000 + 90 * 24 * 60 * 60
        : null;
    return c.json(
      {
        referrer: agent.referredBy,
        referral_link: `${deps.publicBaseUrl}/.well-known/mcp.json?ref=${agent.pubkey}`,
        referred_discount_until: discountUntil,
        referred: referred.map((r) => ({
          pubkey: r.pubkey,
          registered_at: seconds(r.registeredAt) as number,
          activated_at: seconds(r.activatedAt),
        })),
        credits: own.map((r) => ({
          amount: r.amount,
          remaining: r.remaining,
          accrued_at: seconds(r.accruedAt) as number,
          expires_at: seconds(r.expiresAt) as number,
        })),
        available_credits: `${await availableCredits(deps.db, agent.pubkey, now)}`,
      },
      200,
    );
  });

  app.openapi(historyRoute, async (c) => {
    const agent = await requireAgent(deps, c);
    const { limit, before } = c.req.valid("query");
    const mine = or(eq(receipts.payer, agent.pubkey), eq(receipts.payee, agent.pubkey));
    const rows = await deps.db
      .select()
      .from(receipts)
      .where(before ? and(mine, lt(receipts.issuedAt, new Date(before * 1000))) : mine)
      .orderBy(desc(receipts.issuedAt), desc(receipts.id))
      .limit(limit);
    return c.json(
      {
        receipts: rows.map((r) => ({
          signature: r.transaction,
          receipt: r.jws,
          receipt_data: JSON.parse(Buffer.from(r.jws.split(".")[1] ?? "", "base64url").toString()),
        })),
      },
      200,
    );
  });
}

/**
 * Verifies the signature of the pending challenge for this pubkey against the pubkey itself
 * (section D) and consumes it: challenges are single-use and expire after 5 minutes.
 */
async function consumeChallenge(deps: AppDeps, pubkey: string, signature: string) {
  const invalid = () => new M2mError("CHALLENGE_INVALID");
  const record = await deps.kv.get(`challenge:${pubkey}`);
  if (!record) throw invalid();
  const { nonce, expiresAt } = JSON.parse(record) as { nonce: string; expiresAt: number };
  if (deps.now() > expiresAt) throw invalid();
  let valid = false;
  try {
    const bytes = getBase58Encoder().encode(signature);
    valid =
      bytes.length === 64 &&
      (await verifySignature(
        await getPublicKeyFromAddress(pubkey as Address),
        bytes as SignatureBytes,
        getUtf8Encoder().encode(registrationMessage(pubkey, nonce)),
      ));
  } catch {
    valid = false;
  }
  if (!valid) throw invalid();
  if (!(await deps.kv.setIfAbsent(`challenge-used:${nonce}`, "1", CHALLENGE_TTL_MS))) {
    throw invalid();
  }
}
