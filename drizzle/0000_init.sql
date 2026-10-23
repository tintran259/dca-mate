CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"level_id" integer,
	"kind" text NOT NULL,
	"price" integer NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"kind" text NOT NULL,
	"pct" double precision NOT NULL,
	"quantity" integer,
	"sell_pct" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"thesis" text,
	"dca_base" text DEFAULT 'first' NOT NULL,
	"max_capital" integer,
	"stop_loss_pct" double precision,
	"trailing_pct" double precision,
	"last_price" integer,
	"last_price_at" timestamp with time zone,
	"peak_price" integer,
	"stop_notified_at" timestamp with time zone,
	"trail_notified_peak" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"side" text NOT NULL,
	"trade_date" date NOT NULL,
	"price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_level_id_plan_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."plan_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_levels" ADD CONSTRAINT "plan_levels_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plan_levels_position_idx" ON "plan_levels" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "transactions_position_idx" ON "transactions" USING btree ("position_id");