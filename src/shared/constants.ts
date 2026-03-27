export const CONVERSATION_STATUSES = ["active", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_AUTHOR_TYPES = ["user", "agent", "system"] as const;
export type ConversationAuthorType = (typeof CONVERSATION_AUTHOR_TYPES)[number];

export const CONVERSATION_MESSAGE_REF_KINDS = [
  "agent",
  "issue",
  "goal",
  "project",
] as const;
export type ConversationMessageRefKind =
  (typeof CONVERSATION_MESSAGE_REF_KINDS)[number];

export const CONVERSATION_MESSAGE_REF_ORIGINS = [
  "inline_mention",
  "active_context",
] as const;
export type ConversationMessageRefOrigin =
  (typeof CONVERSATION_MESSAGE_REF_ORIGINS)[number];

export const CONVERSATION_TARGET_KINDS = [
  "issue",
  "goal",
  "project",
] as const;
export type ConversationTargetKind =
  (typeof CONVERSATION_TARGET_KINDS)[number];

export const CONVERSATION_LINK_ORIGINS = [
  "message_ref",
  "manual",
  "system",
] as const;
export type ConversationLinkOrigin =
  (typeof CONVERSATION_LINK_ORIGINS)[number];

export const CONVERSATION_ACTOR_TYPES = ["user", "agent", "system"] as const;
export type ConversationActorType =
  (typeof CONVERSATION_ACTOR_TYPES)[number];

export const CONVERSATION_MEMORY_BUILD_STATUSES = [
  "ready",
  "rebuilding",
  "failed",
] as const;
export type ConversationMemoryBuildStatus =
  (typeof CONVERSATION_MEMORY_BUILD_STATUSES)[number];

export const CONVERSATION_RESPONSE_MODES = ["optional", "required"] as const;
export type ConversationResponseMode =
  (typeof CONVERSATION_RESPONSE_MODES)[number];

export const CONVERSATION_WAKE_POLICY_MAX_LEVELS = 10;

export const CONVERSATION_WAKE_POLICY_DEFAULT = {
  agentHumanStep: 1,
  hierarchyStep: 1,
  wakeChancePercents: [100, 70, 50] as const,
} as const;
