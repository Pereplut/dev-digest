ALTER TABLE "eval_runs" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "ci_runs" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(12, 6);