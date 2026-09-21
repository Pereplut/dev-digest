CREATE INDEX "pr_commits_pr_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_files_pr_idx" ON "pr_files" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_created_idx" ON "reviews" USING btree ("pr_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_ws_pr_kind_idx" ON "reviews" USING btree ("workspace_id","pr_id","kind");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_ran_idx" ON "agent_runs" USING btree ("pr_id","ran_at");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_done_idx" ON "agent_runs" USING btree ("pr_id") WHERE status = 'done';