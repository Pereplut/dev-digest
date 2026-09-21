ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settings_ws_key_global_uq" ON "settings" USING btree ("workspace_id","key") WHERE user_id is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_uq" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_name_uq" UNIQUE("name");