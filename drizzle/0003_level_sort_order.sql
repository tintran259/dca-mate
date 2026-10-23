ALTER TABLE "plan_levels" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Giữ đúng thứ tự cũ (theo id) cho các nấc đã có
UPDATE "plan_levels" SET "sort_order" = "id";
