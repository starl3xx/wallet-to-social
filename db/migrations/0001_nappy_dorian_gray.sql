CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_agent" text,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ip_rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_address" text NOT NULL,
	"endpoint" text NOT NULL,
	"bucket_key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "social_graph_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"field_changed" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"change_source" text
);
--> statement-breakpoint
ALTER TABLE "lookup_history" ADD COLUMN "last_viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "lookup_history" ADD COLUMN "input_source" text;--> statement-breakpoint
ALTER TABLE "social_graph" ADD COLUMN "twitter_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "social_graph" ADD COLUMN "farcaster_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "social_graph" ADD COLUMN "data_quality_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "social_graph" ADD COLUMN "last_verification_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_graph" ADD COLUMN "stale_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallets_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_rate_limit_buckets_lookup_idx" ON "ip_rate_limit_buckets" USING btree ("ip_address","endpoint","bucket_key");--> statement-breakpoint
CREATE INDEX "ip_rate_limit_buckets_created_at_idx" ON "ip_rate_limit_buckets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_email_idx" ON "magic_link_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_expires_at_idx" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "social_graph_history_wallet_idx" ON "social_graph_history" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "social_graph_history_changed_at_idx" ON "social_graph_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "social_graph_history_field_changed_idx" ON "social_graph_history" USING btree ("field_changed");--> statement-breakpoint
CREATE INDEX "lookup_history_user_created_idx" ON "lookup_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "lookup_jobs_status_created_idx" ON "lookup_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "social_graph_stale_at_idx" ON "social_graph" USING btree ("stale_at");