CREATE TABLE "daily_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"quotes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "source" text DEFAULT 'relay' NOT NULL;