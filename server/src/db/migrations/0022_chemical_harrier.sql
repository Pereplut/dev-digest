CREATE TABLE "eval_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cases_total" integer NOT NULL,
	"cases_passed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"cost_usd" numeric(12, 6)
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expected_file" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expected_start_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expected_end_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_run_batches_owner_live_uq" ON "eval_run_batches" USING btree ("owner_id") WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_run_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_run_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_source_uq" ON "eval_cases" USING btree ("owner_id","source_finding_id") WHERE source_finding_id is not null;