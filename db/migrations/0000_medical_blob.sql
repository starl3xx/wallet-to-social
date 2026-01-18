CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"user_id" text,
	"session_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"rate_limit" integer,
	"daily_limit" integer,
	"monthly_limit" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "api_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"latency_ms" integer,
	"status_code" integer,
	"error_message" text,
	"wallet_count" integer,
	"job_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_monthly" integer NOT NULL,
	"requests_per_minute" integer NOT NULL,
	"requests_per_day" integer NOT NULL,
	"requests_per_month" integer NOT NULL,
	"max_batch_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"wallet_count" integer DEFAULT 1 NOT NULL,
	"response_status" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"credits_used" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"date" date PRIMARY KEY NOT NULL,
	"total_lookups" integer DEFAULT 0 NOT NULL,
	"total_wallets_processed" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"pro_purchases" integer DEFAULT 0 NOT NULL,
	"unlimited_purchases" integer DEFAULT 0 NOT NULL,
	"avg_match_rate" numeric(5, 2),
	"cache_hit_rate" numeric(5, 2),
	"avg_latency_ms" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookup_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"user_id" text,
	"wallet_count" integer NOT NULL,
	"twitter_found" integer NOT NULL,
	"farcaster_found" integer NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"wallets" jsonb NOT NULL,
	"original_data" jsonb,
	"options" jsonb NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"current_stage" text,
	"partial_results" jsonb,
	"twitter_found" integer DEFAULT 0 NOT NULL,
	"farcaster_found" integer DEFAULT 0 NOT NULL,
	"any_social_found" integer DEFAULT 0 NOT NULL,
	"cache_hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"bucket_type" text NOT NULL,
	"bucket_key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_graph" (
	"wallet" text PRIMARY KEY NOT NULL,
	"ens_name" text,
	"twitter_handle" text,
	"twitter_url" text,
	"farcaster" text,
	"farcaster_url" text,
	"fc_followers" integer,
	"fc_fid" integer,
	"lens" text,
	"github" text,
	"sources" text[],
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"lookup_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_payment_id" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallet_cache" (
	"wallet" text PRIMARY KEY NOT NULL,
	"ens_name" text,
	"twitter_handle" text,
	"twitter_url" text,
	"farcaster" text,
	"farcaster_url" text,
	"fc_followers" integer,
	"lens" text,
	"github" text,
	"sources" text[],
	"cached_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"wallet" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_plan_api_plans_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."api_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_type_created_idx" ON "analytics_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_id_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_events_session_id_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_idx" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_keys_is_active_idx" ON "api_keys" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "api_metrics_provider_created_idx" ON "api_metrics" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "api_metrics_job_id_idx" ON "api_metrics" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "api_usage_api_key_id_idx" ON "api_usage" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_usage_created_at_idx" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_usage_api_key_created_idx" ON "api_usage" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "lookup_history_created_at_idx" ON "lookup_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lookup_history_user_id_idx" ON "lookup_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lookup_jobs_status_idx" ON "lookup_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lookup_jobs_created_at_idx" ON "lookup_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_lookup_idx" ON "rate_limit_buckets" USING btree ("api_key_id","bucket_type","bucket_key");--> statement-breakpoint
CREATE INDEX "social_graph_twitter_idx" ON "social_graph" USING btree ("twitter_handle");--> statement-breakpoint
CREATE INDEX "social_graph_farcaster_idx" ON "social_graph" USING btree ("farcaster");--> statement-breakpoint
CREATE INDEX "social_graph_ens_idx" ON "social_graph" USING btree ("ens_name");--> statement-breakpoint
CREATE INDEX "social_graph_fc_followers_idx" ON "social_graph" USING btree ("fc_followers");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "wallet_cache_cached_at_idx" ON "wallet_cache" USING btree ("cached_at");--> statement-breakpoint
CREATE INDEX "whitelist_email_idx" ON "whitelist" USING btree ("email");--> statement-breakpoint
CREATE INDEX "whitelist_wallet_idx" ON "whitelist" USING btree ("wallet");