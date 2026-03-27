import { z } from "zod";
import {
  CONVERSATION_STATUSES,
  CONVERSATION_TARGET_KINDS,
  CONVERSATION_RESPONSE_MODES,
} from "./constants.js";

const uuid = z.string().uuid();

export const CreateConversationSchema = z.object({
  title: z.string().min(1).max(500),
  participantAgentIds: z
    .array(uuid)
    .min(1)
    .transform((ids) => [...new Set(ids)]),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const UpdateConversationSchema = z.object({
  conversationId: uuid,
  title: z.string().min(1).max(500).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  wakePolicy: z
    .object({
      agentHumanStep: z.number().int().min(0).max(10),
      hierarchyStep: z.number().int().min(0).max(10),
      wakeChancePercents: z.array(z.number().int().min(0).max(100)).min(1).max(10),
    })
    .optional(),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;

export const CreateConversationMessageSchema = z.object({
  conversationId: uuid,
  bodyMarkdown: z.string().min(1).max(50000),
  activeContextTargets: z
    .array(
      z.object({
        targetKind: z.enum(CONVERSATION_TARGET_KINDS),
        targetId: uuid,
        displayText: z.string().min(1).max(500),
      }),
    )
    .max(20)
    .default([]),
  parentId: uuid.nullable().optional().default(null),
});
export type CreateConversationMessageInput = z.infer<
  typeof CreateConversationMessageSchema
>;

export const DeleteConversationMessageSchema = z.object({
  conversationId: uuid,
  messageId: uuid,
});

export const ListConversationMessagesSchema = z.object({
  conversationId: uuid,
  beforeSequence: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(500).optional(),
  targetKind: z.enum(CONVERSATION_TARGET_KINDS).optional(),
  targetId: uuid.optional(),
  aroundMessageId: uuid.optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
});
export type ListConversationMessagesInput = z.infer<
  typeof ListConversationMessagesSchema
>;

export const MarkConversationReadSchema = z.object({
  conversationId: uuid,
  lastReadSequence: z.number().int().min(0),
});

export const AddParticipantSchema = z.object({
  conversationId: uuid,
  agentId: uuid,
});

export const RemoveParticipantSchema = z.object({
  conversationId: uuid,
  agentId: uuid,
});

export const ListConversationsSchema = z.object({
  status: z.enum(["active", "archived", "all"]).optional().default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  targetKind: z.enum(CONVERSATION_TARGET_KINDS).optional(),
  targetId: uuid.optional(),
});
export type ListConversationsInput = z.infer<typeof ListConversationsSchema>;

export const CreateTargetLinkSchema = z.object({
  conversationId: uuid,
  targetKind: z.enum(CONVERSATION_TARGET_KINDS),
  targetId: uuid,
  anchorMessageId: uuid,
  agentIds: z.array(uuid).min(1),
});
export type CreateTargetLinkInput = z.infer<typeof CreateTargetLinkSchema>;

export const DeleteTargetLinkSchema = z.object({
  conversationId: uuid,
  targetKind: z.enum(CONVERSATION_TARGET_KINDS),
  targetId: uuid,
  agentIds: z.array(uuid).min(1),
});
export type DeleteTargetLinkInput = z.infer<typeof DeleteTargetLinkSchema>;

export const SelectConversationSchema = z.object({
  conversationId: uuid.nullable(),
  targetKind: z.enum(CONVERSATION_TARGET_KINDS).nullable(),
  targetId: uuid.nullable(),
});

export const TargetPickerOptionsSchema = z.object({
  q: z.string().max(500),
  allowedKinds: z.array(z.enum(CONVERSATION_TARGET_KINDS)).optional(),
});

export const ConversationReplyV1Schema = z.object({
  kind: z.literal("conversation.reply.v1"),
  bodyMarkdown: z.string(),
  parentId: z.string().nullable(),
  activeContextTargets: z.array(
    z.object({
      targetKind: z.enum(CONVERSATION_TARGET_KINDS),
      targetId: z.string(),
      displayText: z.string(),
    }),
  ),
  manualTargetLinks: z.array(
    z.object({
      action: z.enum(["link", "unlink"]),
      targetKind: z.enum(CONVERSATION_TARGET_KINDS),
      targetId: z.string(),
    }),
  ),
});
export type ConversationReplyV1 = z.infer<typeof ConversationReplyV1Schema>;
