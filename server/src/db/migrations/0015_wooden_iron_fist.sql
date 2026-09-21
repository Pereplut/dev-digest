CREATE TABLE "run_skills" (
	"run_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"skill_id" uuid,
	"skill_name" text NOT NULL,
	"version" integer NOT NULL,
	"tokens" integer NOT NULL,
	CONSTRAINT "run_skills_run_id_order_pk" PRIMARY KEY("run_id","order")
);
--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "type" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_skills_skill_id_idx" ON "run_skills" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_name_uq" UNIQUE("workspace_id","name");