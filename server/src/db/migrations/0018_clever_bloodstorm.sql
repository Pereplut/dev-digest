ALTER TABLE "conventions" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;