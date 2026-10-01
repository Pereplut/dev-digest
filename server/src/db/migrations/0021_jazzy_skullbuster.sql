ALTER TABLE "onboarding" ADD COLUMN "status" text DEFAULT 'not_generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "generation_id" uuid;