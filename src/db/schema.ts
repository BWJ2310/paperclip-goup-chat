import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  uniqueIndex,
  index,
  check,
  boolean,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── conversations ──

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    lastMessageSequence: bigint("last_message_sequence", { mode: "number" })
      .notNull()
      .default(0),
    wakePolicyJson: jsonb("wake_policy_json").notNull().default(
      sql`'{"agentHumanStep":1,"hierarchyStep":1,"wakeChancePercents":[100,70,50]}'::jsonb`,
    ),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: text("created_by_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_company_status_updated_idx").on(
      t.companyId,
      t.status,
      t.updatedAt,
    ),
    index("conversations_company_updated_idx").on(t.companyId, t.updatedAt),
  ],
);

// ── conversation_messages ──

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    parentId: uuid("parent_id"),
    authorType: text("author_type").notNull(),
    authorUserId: text("author_user_id"),
    authorAgentId: text("author_agent_id"),
    runId: text("run_id"),
    bodyMarkdown: text("body_markdown").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_messages_conv_seq_idx").on(
      t.conversationId,
      t.sequence,
    ),
    index("conversation_messages_conv_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  ],
);

// ── conversation_message_refs ──

export const conversationMessageRefs = pgTable(
  "conversation_message_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    refKind: text("ref_kind").notNull(),
    targetId: text("target_id").notNull(),
    displayText: text("display_text").notNull(),
    refOrigin: text("ref_origin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_message_refs_unique_idx").on(
      t.messageId,
      t.refKind,
      t.targetId,
    ),
  ],
);

// ── conversation_participants ──

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_participants_unique_idx").on(
      t.companyId,
      t.conversationId,
      t.agentId,
    ),
  ],
);

// ── conversation_read_states ──

export const conversationReadStates = pgTable(
  "conversation_read_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    agentId: text("agent_id"),
    lastReadSequence: bigint("last_read_sequence", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_read_states_user_idx").on(
      t.conversationId,
      t.userId,
    ),
    uniqueIndex("conversation_read_states_agent_idx").on(
      t.conversationId,
      t.agentId,
    ),
  ],
);

// ── conversation_target_links ──

export const conversationTargetLinks = pgTable(
  "conversation_target_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    agentId: text("agent_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    displayText: text("display_text"),
    linkOrigin: text("link_origin").notNull(),
    latestLinkedMessageId: uuid("latest_linked_message_id"),
    latestLinkedMessageSequence: bigint("latest_linked_message_sequence", {
      mode: "number",
    }),
    createdByActorType: text("created_by_actor_type").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_target_links_unique_idx").on(
      t.agentId,
      t.conversationId,
      t.targetKind,
      t.targetId,
    ),
    index("conversation_target_links_conv_idx").on(t.conversationId),
  ],
);

// ── conversation_target_suppressions ──

export const conversationTargetSuppressions = pgTable(
  "conversation_target_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    agentId: text("agent_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    suppressedThroughMessageSequence: bigint(
      "suppressed_through_message_sequence",
      { mode: "number" },
    ).notNull(),
    suppressedByActorType: text("suppressed_by_actor_type").notNull(),
    suppressedByActorId: text("suppressed_by_actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_target_suppressions_unique_idx").on(
      t.agentId,
      t.conversationId,
      t.targetKind,
      t.targetId,
    ),
  ],
);

// ── conversation_session_mappings ──

export const conversationSessionMappings = pgTable(
  "conversation_session_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id"),
    taskKey: text("task_key").notNull(),
    taskKeyVersion: integer("task_key_version").notNull().default(1),
    status: text("status").notNull().default("creating"),
    lastWakeRequestId: uuid("last_wake_request_id"),
    lastRunId: uuid("last_run_id"),
    lastCreateStartedAt: timestamp("last_create_started_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_session_mappings_conv_agent_idx").on(
      t.conversationId,
      t.agentId,
    ),
    index("conversation_session_mappings_task_key_idx").on(t.taskKey),
  ],
);

// ── agent_target_conversation_memory ──

export const agentTargetConversationMemory = pgTable(
  "agent_target_conversation_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    agentId: text("agent_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    memoryMarkdown: text("memory_markdown").notNull().default(""),
    buildStatus: text("build_status").notNull().default("ready"),
    linkedConversationCount: integer("linked_conversation_count")
      .notNull()
      .default(0),
    linkedMessageCount: integer("linked_message_count").notNull().default(0),
    sourceMessageCount: integer("source_message_count").notNull().default(0),
    lastSourceMessageSequence: bigint("last_source_message_sequence", {
      mode: "number",
    })
      .notNull()
      .default(0),
    latestSourceMessageAt: timestamp("latest_source_message_at", {
      withTimezone: true,
    }),
    lastBuildError: text("last_build_error"),
    lastRebuiltAt: timestamp("last_rebuilt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_target_conv_memory_unique_idx").on(
      t.agentId,
      t.targetKind,
      t.targetId,
    ),
  ],
);

// ── agent_wakeup_requests ──

export const agentWakeupRequests = pgTable(
  "agent_wakeup_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    agentId: text("agent_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    conversationMessageId: uuid("conversation_message_id"),
    conversationMessageSequence: bigint("conversation_message_sequence", {
      mode: "number",
    }),
    responseMode: text("response_mode").notNull().default("optional"),
    source: text("source").notNull(),
    triggerDetail: text("trigger_detail").notNull().default(""),
    reason: text("reason").notNull().default(""),
    payload: jsonb("payload"),
    coalescedCount: integer("coalesced_count").notNull().default(0),
    requestedByActorType: text("requested_by_actor_type").notNull(),
    requestedByActorId: text("requested_by_actor_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    runId: uuid("run_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_wakeup_requests_conv_idx").on(t.conversationId),
    index("agent_wakeup_requests_agent_conv_idx").on(
      t.agentId,
      t.conversationId,
    ),
    index("agent_wakeup_requests_status_idx").on(t.status),
  ],
);

// ── conversation_run_records ──

export const conversationRunRecords = pgTable(
  "conversation_run_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id").notNull(),
    wakeRequestId: uuid("wake_request_id"),
    hostRunId: text("host_run_id"),
    status: text("status").notNull().default("starting"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversation_run_records_conv_idx").on(t.conversationId),
    index("conversation_run_records_session_idx").on(t.sessionId),
    index("conversation_run_records_host_run_idx").on(t.hostRunId),
  ],
);

// ── conversation_run_telemetry_events ──

export const conversationRunTelemetryEvents = pgTable(
  "conversation_run_telemetry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runRecordId: uuid("run_record_id")
      .notNull()
      .references(() => conversationRunRecords.id, { onDelete: "cascade" }),
    eventSeq: integer("event_seq").notNull(),
    eventType: text("event_type").notNull(),
    stream: text("stream"),
    message: text("message"),
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversation_run_telemetry_events_run_idx").on(t.runRecordId),
  ],
);

// ── conversation_run_telemetry_rollups ──

export const conversationRunTelemetryRollups = pgTable(
  "conversation_run_telemetry_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    runCount: integer("run_count").notNull().default(0),
    totalInputTokens: bigint("total_input_tokens", { mode: "number" }),
    totalOutputTokens: bigint("total_output_tokens", { mode: "number" }),
    totalSpendCents: real("total_spend_cents"),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_run_telemetry_rollups_unique_idx").on(
      t.conversationId,
      t.agentId,
    ),
  ],
);

// ── conversation_ui_state ──

export const conversationUiState = pgTable(
  "conversation_ui_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull(),
    lastConversationId: uuid("last_conversation_id"),
    lastTargetKind: text("last_target_kind"),
    lastTargetId: text("last_target_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_ui_state_company_user_idx").on(
      t.companyId,
      t.userId,
    ),
  ],
);
