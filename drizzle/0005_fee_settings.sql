CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"buy_fee_rate" double precision,
	"sell_fee_rate" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
