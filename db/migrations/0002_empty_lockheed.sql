ALTER TABLE "lookup_jobs" ADD COLUMN "social_graph_write_status" text;--> statement-breakpoint
ALTER TABLE "lookup_jobs" ADD COLUMN "social_graph_write_errors" text[];--> statement-breakpoint
ALTER TABLE "wallet_cache" ADD COLUMN "fc_fid" integer;