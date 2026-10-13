CREATE TABLE "agents" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"referred_by" text,
	"api_key_hash" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"first_settlement_at" timestamp with time zone,
	"settlements_as_payee" integer DEFAULT 0 NOT NULL,
	"volume_as_payee" numeric(30, 0) DEFAULT '0' NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "credit_reservations" (
	"quote_id" text PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"amount" numeric(20, 0) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer" text NOT NULL,
	"referred" text NOT NULL,
	"amount" numeric(20, 0) NOT NULL,
	"remaining" numeric(20, 0) NOT NULL,
	"accrued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_referred_by_agents_pubkey_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."agents"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_agent_agents_pubkey_fk" FOREIGN KEY ("agent") REFERENCES "public"."agents"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_referrer_agents_pubkey_fk" FOREIGN KEY ("referrer") REFERENCES "public"."agents"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_referred_agents_pubkey_fk" FOREIGN KEY ("referred") REFERENCES "public"."agents"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_referred_by_idx" ON "agents" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "credits_referrer_idx" ON "credits" USING btree ("referrer","expires_at");