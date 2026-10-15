ALTER TABLE "ci_installations" ADD COLUMN "status" text DEFAULT 'pr_open' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text DEFAULT 'github_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "repository_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ci_installation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "external_pr_number" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "actions_run_id" bigint;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "job_url" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ci_gate_triggered" boolean;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_ci_installation_id_ci_installations_id_fk" FOREIGN KEY ("ci_installation_id") REFERENCES "public"."ci_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_ci_installation_actions_run_uq" ON "agent_runs" USING btree ("ci_installation_id","actions_run_id");--> statement-breakpoint
ALTER TABLE "ci_installations" ADD CONSTRAINT "ci_installations_agent_repo_uq" UNIQUE("agent_id","repo");