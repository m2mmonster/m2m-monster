// Postgres schema. Migrations: `pnpm --filter @m2m-monster/api db:generate` (drizzle/).
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const units = (name: string) => numeric(name, { precision: 20, scale: 0 }).notNull();
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Registered agents (section D). Registration is optional to pay and get paid. */
export const agents = pgTable(
  "agents",
  {
    pubkey: text("pubkey").primaryKey(),
    agentId: text("agent_id").notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().notNull(),
    /** Single, permanent referrer (section C). */
    referredBy: text("referred_by").references((): AnyPgColumn => agents.pubkey),
    /** SHA-256 of the api_key; the key itself is never stored. */
    apiKeyHash: text("api_key_hash").notNull().unique(),
    registeredAt: at("registered_at").notNull(),
    firstSettlementAt: at("first_settlement_at"),
    settlementsAsPayee: integer("settlements_as_payee").notNull().default(0),
    /** Settled volume as payee, in USDC base units. */
    volumeAsPayee: numeric("volume_as_payee", { precision: 30, scale: 0 }).notNull().default("0"),
    /** When the referral activation threshold was reached (section C). */
    activatedAt: at("activated_at"),
  },
  (t) => [index("agents_referred_by_idx").on(t.referredBy)],
);

/** Referral credits: not cash, not withdrawable or transferable, expire after 12 months. */
export const credits = pgTable(
  "credits",
  {
    /** Receipt id of the fee that generated the credit. */
    id: text("id").primaryKey(),
    referrer: text("referrer")
      .notNull()
      .references(() => agents.pubkey),
    referred: text("referred")
      .notNull()
      .references(() => agents.pubkey),
    amount: units("amount"),
    remaining: units("remaining"),
    accruedAt: at("accrued_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("credits_referrer_idx").on(t.referrer, t.expiresAt)],
);

/** Credits held by an open quote so two quotes cannot spend the same credits (D6). */
export const creditReservations = pgTable("credit_reservations", {
  quoteId: text("quote_id").primaryKey(),
  agent: text("agent")
    .notNull()
    .references(() => agents.pubkey),
  amount: units("amount"),
  expiresAt: at("expires_at").notNull(),
});

/** One signed receipt per settled quote (sections 0, C, G; D8, D14). */
export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    network: text("network").notNull(),
    transaction: text("transaction").notNull().unique(),
    payer: text("payer").notNull(),
    payee: text("payee").notNull(),
    mint: text("mint").notNull(),
    amount: units("amount"),
    payeeAmount: units("payee_amount"),
    feeGross: units("fee_gross"),
    discount: units("discount"),
    feeNet: units("fee_net"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    jws: text("jws").notNull(),
  },
  (t) => [
    index("receipts_payee_idx").on(t.payee, t.issuedAt),
    index("receipts_payer_idx").on(t.payer, t.issuedAt),
  ],
);
