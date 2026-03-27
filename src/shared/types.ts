import type {
  ConversationStatus,
  ConversationAuthorType,
  ConversationMessageRefKind,
  ConversationMessageRefOrigin,
  ConversationTargetKind,
  ConversationLinkOrigin,
  ConversationActorType,
  ConversationMemoryBuildStatus,
  ConversationResponseMode,
} from "./constants.js";

// ── Wake Policy ──

export interface ConversationWakePolicy {
  agentHumanStep: number;
  hierarchyStep: number;
  wakeChancePercents: number[];
}

// ── Active Context Target ──

export interface ConversationActiveContextTarget {
  targetKind: ConversationTargetKind;
  targetId: string;
  displayText: string;
}

// ── Message Ref ──

export interface ConversationMessageRef {
  id: string;
  messageId: string;
  refKind: ConversationMessageRefKind;
  targetId: string;
  displayText: string;
  refOrigin: ConversationMessageRefOrigin;
}

// ── Message ──

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequence: number;
  parentId: string | null;
  authorType: ConversationAuthorType;
  authorUserId: string | null;
  authorAgentId: string | null;
  authorDisplayName: string | null;
  authorIcon: string | null;
  runId: string | null;
  bodyMarkdown: string;
  refs: ConversationMessageRef[];
  parentSummary: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Message Page ──

export interface ConversationMessagePage {
  messages: ConversationMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

// ── Participant ──

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  agentIcon: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  agentStatus: string | null;
  agentModel: string | null;
  agentThinkingEffort: string | null;
  joinedAt: string;
}

// ── Read State ──

export interface ConversationReadState {
  id: string;
  conversationId: string;
  userId: string | null;
  agentId: string | null;
  lastReadSequence: number;
  updatedAt: string;
}

// ── Target Link ──

export interface ConversationTargetLink {
  id: string;
  conversationId: string;
  agentId: string;
  targetKind: ConversationTargetKind;
  targetId: string;
  displayText: string | null;
  linkOrigin: ConversationLinkOrigin;
  latestLinkedMessageId: string;
  latestLinkedMessageSequence: number;
  createdByActorType: ConversationActorType;
  createdByActorId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Target Suppression ──

export interface ConversationTargetSuppression {
  id: string;
  conversationId: string;
  agentId: string;
  targetKind: ConversationTargetKind;
  targetId: string;
  suppressedThroughMessageSequence: number;
  suppressedByActorType: ConversationActorType;
  suppressedByActorId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Memory Artifact ──

export interface AgentTargetConversationMemory {
  id: string;
  agentId: string;
  targetKind: ConversationTargetKind;
  targetId: string;
  memoryMarkdown: string;
  buildStatus: ConversationMemoryBuildStatus;
  linkedConversationCount: number;
  linkedMessageCount: number;
  sourceMessageCount: number;
  lastSourceMessageSequence: number;
  latestSourceMessageAt: string | null;
  lastBuildError: string | null;
  lastRebuiltAt: string;
  createdAt: string;
  updatedAt: string;
}

// ── Conversation Summary ──

export interface ConversationSummary {
  id: string;
  companyId: string;
  title: string;
  status: ConversationStatus;
  lastMessageSequence: number;
  latestMessageSequence: number;
  latestMessageAt: string | null;
  wakePolicy: ConversationWakePolicy;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  participants: ConversationParticipant[];
  latestMessage: ConversationMessage | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Conversation Detail ──

export interface ConversationCostSummary {
  telemetryAvailable: boolean;
  spendCents: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  runCount: number;
  lastOccurredAt: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  costSummary: ConversationCostSummary;
  viewerReadState: ConversationReadState | null;
  targetLinks: ConversationTargetLink[];
}

// ── Wake Policy ──

export interface WakePacket {
  taskKey: string;
  conversationId: string;
  conversationMessageId: string;
  conversationMessageSequence: number;
  conversationResponseMode: ConversationResponseMode;
  wakeLevel: number;
  agentId: string;
  targetKind: ConversationTargetKind | null;
  targetId: string | null;
  reason: string;
  source: string;
  triggerDetail: string;
  replyContextMarkdown: string;
  memoryMarkdown: string | null;
}

// ── Run Correlation ──

export interface ConversationRunRecord {
  id: string;
  conversationId: string;
  agentId: string;
  sessionId: string;
  wakeRequestId: string | null;
  hostRunId: string | null;
  status: string;
  startedAt: string;
  lastEventAt: string;
  finishedAt: string | null;
  error: string | null;
}

// ── Run Telemetry ──

export interface ConversationRunTelemetryEvent {
  id: string;
  runRecordId: string;
  eventSeq: number;
  eventType: string;
  stream: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

export interface ConversationRunTelemetryRollup {
  id: string;
  conversationId: string;
  agentId: string;
  runCount: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalSpendCents: number | null;
  lastOccurredAt: string | null;
  updatedAt: string;
}

// ── UI State ──

export interface ConversationUiState {
  lastConversationId: string | null;
  lastTargetKind: ConversationTargetKind | null;
  lastTargetId: string | null;
  updatedAt: string;
}

// ── Session Mapping ──

export interface ConversationSessionMapping {
  id: string;
  conversationId: string;
  agentId: string;
  sessionId: string | null;
  taskKey: string;
  taskKeyVersion: number;
  status: string;
  lastWakeRequestId: string | null;
  lastRunId: string | null;
  lastCreateStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Board Actor Envelope ──

export interface BoardActorEnvelope {
  companyId: string;
  userId: string | null;
  actorType: "user";
  projectId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  renderSnapshot?: {
    environment: string;
    launcherId: string;
    bounds: string;
  } | null;
}

// ── Uniform Request Wrapper ──

export interface PluginRequest<TParams = Record<string, unknown>> {
  actor: BoardActorEnvelope;
  params: TParams;
}

// ── Stream Invalidation ──

export interface ConversationInvalidationEvent {
  type: string;
  conversationId: string;
  revision: number;
  listChanged?: boolean;
  threadChanged?: boolean;
  readStateChanged?: boolean;
  telemetryChanged?: boolean;
}
