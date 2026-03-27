CREATE TABLE "agent_target_conversation_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"memory_markdown" text DEFAULT '' NOT NULL,
	"build_status" text DEFAULT 'ready' NOT NULL,
	"linked_conversation_count" integer DEFAULT 0 NOT NULL,
	"linked_message_count" integer DEFAULT 0 NOT NULL,
	"source_message_count" integer DEFAULT 0 NOT NULL,
	"last_source_message_sequence" bigint DEFAULT 0 NOT NULL,
	"latest_source_message_at" timestamp with time zone,
	"last_build_error" text,
	"last_rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wakeup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"conversation_message_id" uuid,
	"conversation_message_sequence" bigint,
	"response_mode" text DEFAULT 'optional' NOT NULL,
	"source" text NOT NULL,
	"trigger_detail" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"payload" jsonb,
	"coalesced_count" integer DEFAULT 0 NOT NULL,
	"requested_by_actor_type" text NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"idempotency_key" text,
	"run_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"ref_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"display_text" text NOT NULL,
	"ref_origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"parent_id" uuid,
	"author_type" text NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"run_id" text,
	"body_markdown" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text,
	"agent_id" text,
	"last_read_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_run_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"wake_request_id" uuid,
	"host_run_id" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_run_telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_record_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"stream" text,
	"message" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_run_telemetry_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" bigint,
	"total_output_tokens" bigint,
	"total_spend_cents" real,
	"last_occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_session_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text,
	"task_key" text NOT NULL,
	"task_key_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_wake_request_id" uuid,
	"last_run_id" uuid,
	"last_create_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_target_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"display_text" text,
	"link_origin" text NOT NULL,
	"latest_linked_message_id" uuid,
	"latest_linked_message_sequence" bigint,
	"created_by_actor_type" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_target_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"suppressed_through_message_sequence" bigint NOT NULL,
	"suppressed_by_actor_type" text NOT NULL,
	"suppressed_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_ui_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_conversation_id" uuid,
	"last_target_kind" text,
	"last_target_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_sequence" bigint DEFAULT 0 NOT NULL,
	"wake_policy_json" jsonb DEFAULT '{"agentHumanStep":1,"hierarchyStep":1,"wakeChancePercents":[100,70,50]}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_refs" ADD CONSTRAINT "conversation_message_refs_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_run_records" ADD CONSTRAINT "conversation_run_records_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_run_telemetry_events" ADD CONSTRAINT "conversation_run_telemetry_events_run_record_id_conversation_run_records_id_fk" FOREIGN KEY ("run_record_id") REFERENCES "public"."conversation_run_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_run_telemetry_rollups" ADD CONSTRAINT "conversation_run_telemetry_rollups_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_session_mappings" ADD CONSTRAINT "conversation_session_mappings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_target_links" ADD CONSTRAINT "conversation_target_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_target_suppressions" ADD CONSTRAINT "conversation_target_suppressions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_target_conv_memory_unique_idx" ON "agent_target_conversation_memory" USING btree ("agent_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "agent_wakeup_requests_conv_idx" ON "agent_wakeup_requests" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_wakeup_requests_agent_conv_idx" ON "agent_wakeup_requests" USING btree ("agent_id","conversation_id");--> statement-breakpoint
CREATE INDEX "agent_wakeup_requests_status_idx" ON "agent_wakeup_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_refs_unique_idx" ON "conversation_message_refs" USING btree ("message_id","ref_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conv_seq_idx" ON "conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_messages_conv_created_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_unique_idx" ON "conversation_participants" USING btree ("company_id","conversation_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_read_states_user_idx" ON "conversation_read_states" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_read_states_agent_idx" ON "conversation_read_states" USING btree ("conversation_id","agent_id");--> statement-breakpoint
CREATE INDEX "conversation_run_records_conv_idx" ON "conversation_run_records" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_run_records_session_idx" ON "conversation_run_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "conversation_run_records_host_run_idx" ON "conversation_run_records" USING btree ("host_run_id");--> statement-breakpoint
CREATE INDEX "conversation_run_telemetry_events_run_idx" ON "conversation_run_telemetry_events" USING btree ("run_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_run_telemetry_rollups_unique_idx" ON "conversation_run_telemetry_rollups" USING btree ("conversation_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_session_mappings_conv_agent_idx" ON "conversation_session_mappings" USING btree ("conversation_id","agent_id");--> statement-breakpoint
CREATE INDEX "conversation_session_mappings_task_key_idx" ON "conversation_session_mappings" USING btree ("task_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_target_links_unique_idx" ON "conversation_target_links" USING btree ("agent_id","conversation_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "conversation_target_links_conv_idx" ON "conversation_target_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_target_suppressions_unique_idx" ON "conversation_target_suppressions" USING btree ("agent_id","conversation_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_ui_state_company_user_idx" ON "conversation_ui_state" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "conversations_company_status_updated_idx" ON "conversations" USING btree ("company_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_company_updated_idx" ON "conversations" USING btree ("company_id","updated_at");