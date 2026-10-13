CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"transaction" text NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20, 0) NOT NULL,
	"payee_amount" numeric(20, 0) NOT NULL,
	"fee_gross" numeric(20, 0) NOT NULL,
	"discount" numeric(20, 0) NOT NULL,
	"fee_net" numeric(20, 0) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"jws" text NOT NULL,
	CONSTRAINT "receipts_transaction_unique" UNIQUE("transaction")
);
--> statement-breakpoint
CREATE INDEX "receipts_payee_idx" ON "receipts" USING btree ("payee","issued_at");--> statement-breakpoint
CREATE INDEX "receipts_payer_idx" ON "receipts" USING btree ("payer","issued_at");