import { eq, and, desc, asc, lt, gt, sql, inArray, isNull, count, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type {
  BoardActorEnvelope,
  ConversationSummary,
  ConversationDetail,
  ConversationMessage,
  ConversationMessagePage,
  ConversationParticipant,
  ConversationReadState,
  ConversationTargetLink,
  ConversationCostSummary,
  ConversationActiveContextTarget,
  ConversationWakePolicy,
  ConversationUiState,
} from "../shared/types.js";
import {
  type CreateConversationInput,
  type UpdateConversationInput,
  type CreateConversationMessageInput,
  type ListConversationsInput,
  type ListConversationMessagesInput,
  type CreateTargetLinkInput,
  type DeleteTargetLinkInput,
} from "../shared/validators.js";
import { extractStructuredMentionTokens } from "../shared/structured-mentions.js";
import { CONVERSATION_WAKE_POLICY_DEFAULT } from "../shared/constants.js";
import { conversationMemoryService } from "./conversation-memory.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

export function conversationService(db: Db, ctx: PluginContext) {
  // ── Helpers ──

  async function ensureConversationVisible(
    conversationId: string,
    companyId: string,
  ) {
    const row = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.companyId, companyId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new Error("Conversation not found");
    return row;
  }

  async function getParticipantAgentIds(conversationId: string): Promise<string[]> {
    const rows = await db
      .select({ agentId: schema.conversationParticipants.agentId })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, conversationId));
    return rows.map((r) => r.agentId);
  }

  async function hydrateParticipants(
    conversationId: string,
    companyId: string,
  ): Promise<ConversationParticipant[]> {
    const rows = await db
      .select()
      .from(schema.conversationParticipants)
      .where(
        eq(schema.conversationParticipants.conversationId, conversationId),
      )
      .orderBy(
        asc(schema.conversationParticipants.joinedAt),
        asc(schema.conversationParticipants.id),
      );

    const agentIds = rows.map((r) => r.agentId);
    if (agentIds.length === 0) return [];

    // Fetch agent details from host
    let agentMap: Map<string, { name: string; icon?: string | null; role?: string | null; title?: string | null; status?: string | null }> = new Map();
    try {
      const agents = await ctx.agents.list({ companyId });
      for (const a of agents) {
        agentMap.set(a.id, {
          name: a.name ?? a.id,
          icon: a.icon ?? null,
          role: String(a.role ?? ""),
          title: a.title ?? null,
          status: a.status ?? null,
        });
      }
    } catch {
      // If agent list fails, use fallback
    }

    return rows.map((r) => {
      const agent = agentMap.get(r.agentId);
      return {
        id: r.id,
        conversationId: r.conversationId,
        agentId: r.agentId,
        agentName: agent?.name ?? r.agentId,
        agentIcon: agent?.icon ?? null,
        agentRole: agent?.role ?? null,
        agentTitle: agent?.title ?? null,
        agentStatus: agent?.status ?? null,
        agentModel: null,
        agentThinkingEffort: null,
        joinedAt: r.joinedAt.toISOString(),
      };
    });
  }

  function hydrateMessage(
    row: typeof schema.conversationMessages.$inferSelect,
    refs: (typeof schema.conversationMessageRefs.$inferSelect)[],
    parentSummary: string | null = null,
    authorDisplayName: string | null = null,
    authorIcon: string | null = null,
  ): ConversationMessage {
    return {
      id: row.id,
      conversationId: row.conversationId,
      sequence: row.sequence,
      parentId: row.parentId,
      authorType: row.authorType as "user" | "agent" | "system",
      authorUserId: row.authorUserId,
      authorAgentId: row.authorAgentId,
      authorDisplayName,
      authorIcon,
      runId: row.runId,
      bodyMarkdown: row.bodyMarkdown,
      refs: refs.map((ref) => ({
        id: ref.id,
        messageId: ref.messageId,
        refKind: ref.refKind as "agent" | "issue" | "goal" | "project",
        targetId: ref.targetId,
        displayText: ref.displayText,
        refOrigin: ref.refOrigin as "inline_mention" | "active_context",
      })),
      parentSummary,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function hydrateMessages(
    rows: (typeof schema.conversationMessages.$inferSelect)[],
    companyId: string,
  ): Promise<ConversationMessage[]> {
    if (rows.length === 0) return [];

    const msgIds = rows.map((r) => r.id);
    const refs = await db
      .select()
      .from(schema.conversationMessageRefs)
      .where(inArray(schema.conversationMessageRefs.messageId, msgIds));

    const refsByMsg = new Map<
      string,
      (typeof schema.conversationMessageRefs.$inferSelect)[]
    >();
    for (const ref of refs) {
      const arr = refsByMsg.get(ref.messageId) ?? [];
      arr.push(ref);
      refsByMsg.set(ref.messageId, arr);
    }

    // Load parent summaries for threaded messages
    const parentIds = [...new Set(rows.filter((r) => r.parentId).map((r) => r.parentId!))];
    const parentMap = new Map<string, string>();
    if (parentIds.length > 0) {
      const parents = await db
        .select({
          id: schema.conversationMessages.id,
          sequence: schema.conversationMessages.sequence,
          bodyMarkdown: schema.conversationMessages.bodyMarkdown,
          authorType: schema.conversationMessages.authorType,
          authorUserId: schema.conversationMessages.authorUserId,
          authorAgentId: schema.conversationMessages.authorAgentId,
          deletedAt: schema.conversationMessages.deletedAt,
        })
        .from(schema.conversationMessages)
        .where(inArray(schema.conversationMessages.id, parentIds));
      for (const p of parents) {
        const summary = JSON.stringify({
          sequence: p.sequence,
          authorType: p.authorType,
          authorUserId: p.authorUserId,
          authorAgentId: p.authorAgentId,
          bodyMarkdown: p.bodyMarkdown.length > 200 ? p.bodyMarkdown.slice(0, 200) + "\u2026" : p.bodyMarkdown,
          deletedAt: p.deletedAt?.toISOString() ?? null,
        });
        parentMap.set(p.id, summary);
      }
    }

    // Build agent display name map
    let agentMap: Map<string, { name: string; icon: string | null }> = new Map();
    try {
      const agents = await ctx.agents.list({ companyId });
      for (const a of agents) {
        agentMap.set(a.id, {
          name: a.name ?? a.id,
          icon: a.icon ?? null,
        });
      }
    } catch {
      // fallback
    }

    return rows.map((row) => {
      let authorDisplayName: string | null = null;
      let authorIcon: string | null = null;
      if (row.authorType === "user") {
        authorDisplayName = "Board";
      } else if (row.authorType === "agent" && row.authorAgentId) {
        const agent = agentMap.get(row.authorAgentId);
        authorDisplayName = agent?.name ?? row.authorAgentId;
        authorIcon = agent?.icon ?? null;
      } else if (row.authorType === "system") {
        authorDisplayName = "System";
      }

      return hydrateMessage(
        row,
        refsByMsg.get(row.id) ?? [],
        row.parentId ? parentMap.get(row.parentId) ?? null : null,
        authorDisplayName,
        authorIcon,
      );
    });
  }

  // ── Public API ──

  function escapeLikePattern(s: string): string {
    return s.replace(/[%_\\]/g, (c) => "\\" + c);
  }

  async function list(
    companyId: string,
    userId: string | null,
    input: ListConversationsInput,
  ): Promise<ConversationSummary[]> {
    const conditions = [eq(schema.conversations.companyId, companyId)];
    if (input.status && input.status !== "all") {
      conditions.push(eq(schema.conversations.status, input.status));
    }

    // Target filter: narrow to conversations linked to that target before the main query
    if (input.targetKind && input.targetId) {
      const linkedConvIds = await db
        .select({ conversationId: schema.conversationTargetLinks.conversationId })
        .from(schema.conversationTargetLinks)
        .where(
          and(
            eq(schema.conversationTargetLinks.targetKind, input.targetKind),
            eq(schema.conversationTargetLinks.targetId, input.targetId),
            eq(schema.conversationTargetLinks.companyId, companyId),
          ),
        );
      const ids = linkedConvIds.map((r) => r.conversationId);
      if (ids.length === 0) return [];
      conditions.push(inArray(schema.conversations.id, ids));
    }

    // Enforce limit cap
    const limit = Math.min(input.limit, 100);

    const rows = await db
      .select()
      .from(schema.conversations)
      .where(and(...conditions))
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    const summaries: ConversationSummary[] = [];
    for (const row of rows) {
      const participants = await hydrateParticipants(row.id, companyId);

      // Get latest message
      const latestMsgs = await db
        .select()
        .from(schema.conversationMessages)
        .where(
          and(
            eq(schema.conversationMessages.conversationId, row.id),
            isNull(schema.conversationMessages.deletedAt),
          ),
        )
        .orderBy(desc(schema.conversationMessages.sequence))
        .limit(1);

      const latestMessage =
        latestMsgs.length > 0
          ? (await hydrateMessages(latestMsgs, companyId))[0]
          : null;

      // Get unread count
      let unreadCount = 0;
      if (userId) {
        const readState = await db
          .select()
          .from(schema.conversationReadStates)
          .where(
            and(
              eq(schema.conversationReadStates.conversationId, row.id),
              eq(schema.conversationReadStates.userId, userId),
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        const lastRead = readState?.lastReadSequence ?? 0;
        const unreadRows = await db
          .select({ count: count() })
          .from(schema.conversationMessages)
          .where(
            and(
              eq(schema.conversationMessages.conversationId, row.id),
              gt(schema.conversationMessages.sequence, lastRead),
              isNull(schema.conversationMessages.deletedAt),
            ),
          );
        unreadCount = unreadRows[0]?.count ?? 0;
      }

      summaries.push({
        id: row.id,
        companyId: row.companyId,
        title: row.title,
        status: row.status as "active" | "archived",
        lastMessageSequence: row.lastMessageSequence,
        latestMessageSequence: row.lastMessageSequence,
        latestMessageAt: latestMessage?.createdAt ?? null,
        wakePolicy: (row.wakePolicyJson as ConversationWakePolicy) ?? {
          ...CONVERSATION_WAKE_POLICY_DEFAULT,
        },
        createdByUserId: row.createdByUserId,
        createdByAgentId: row.createdByAgentId,
        participants,
        latestMessage,
        unreadCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    return summaries;
  }

  async function getDetail(
    conversationId: string,
    companyId: string,
    userId: string | null,
  ): Promise<ConversationDetail> {
    const row = await ensureConversationVisible(conversationId, companyId);
    const participants = await hydrateParticipants(row.id, companyId);

    // Latest message
    const latestMsgs = await db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, row.id),
          isNull(schema.conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(1);

    const latestMessage =
      latestMsgs.length > 0
        ? (await hydrateMessages(latestMsgs, companyId))[0]
        : null;

    // Unread count
    let unreadCount = 0;
    let viewerReadState: ConversationReadState | null = null;
    if (userId) {
      const readStateRow = await db
        .select()
        .from(schema.conversationReadStates)
        .where(
          and(
            eq(schema.conversationReadStates.conversationId, row.id),
            eq(schema.conversationReadStates.userId, userId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (readStateRow) {
        viewerReadState = {
          id: readStateRow.id,
          conversationId: readStateRow.conversationId,
          userId: readStateRow.userId,
          agentId: readStateRow.agentId,
          lastReadSequence: readStateRow.lastReadSequence,
          updatedAt: readStateRow.updatedAt.toISOString(),
        };
      }

      const lastRead = readStateRow?.lastReadSequence ?? 0;
      const unreadRows = await db
        .select({ count: count() })
        .from(schema.conversationMessages)
        .where(
          and(
            eq(schema.conversationMessages.conversationId, row.id),
            gt(schema.conversationMessages.sequence, lastRead),
            isNull(schema.conversationMessages.deletedAt),
          ),
        );
      unreadCount = unreadRows[0]?.count ?? 0;
    }

    // Target links
    const targetLinkRows = await db
      .select()
      .from(schema.conversationTargetLinks)
      .where(eq(schema.conversationTargetLinks.conversationId, row.id));

    const targetLinks: ConversationTargetLink[] = targetLinkRows.map((tl) => ({
      id: tl.id,
      conversationId: tl.conversationId,
      agentId: tl.agentId,
      targetKind: tl.targetKind as "issue" | "goal" | "project",
      targetId: tl.targetId,
      displayText: tl.displayText,
      linkOrigin: tl.linkOrigin as "message_ref" | "manual" | "system",
      latestLinkedMessageId: tl.latestLinkedMessageId!,
      latestLinkedMessageSequence: tl.latestLinkedMessageSequence!,
      createdByActorType: tl.createdByActorType as "user" | "agent" | "system",
      createdByActorId: tl.createdByActorId,
      createdAt: tl.createdAt.toISOString(),
      updatedAt: tl.updatedAt.toISOString(),
    }));

    // Cost summary
    const costSummary = await getCostSummary(conversationId);

    return {
      id: row.id,
      companyId: row.companyId,
      title: row.title,
      status: row.status as "active" | "archived",
      lastMessageSequence: row.lastMessageSequence,
      latestMessageSequence: row.lastMessageSequence,
      latestMessageAt: latestMessage?.createdAt ?? null,
      wakePolicy: (row.wakePolicyJson as ConversationWakePolicy) ?? {
        ...CONVERSATION_WAKE_POLICY_DEFAULT,
      },
      createdByUserId: row.createdByUserId,
      createdByAgentId: row.createdByAgentId,
      participants,
      latestMessage,
      unreadCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      costSummary,
      viewerReadState,
      targetLinks,
    };
  }

  async function create(
    companyId: string,
    actor: BoardActorEnvelope,
    input: CreateConversationInput,
  ): Promise<ConversationDetail> {
    const now = new Date();

    const [row] = await db
      .insert(schema.conversations)
      .values({
        companyId,
        title: input.title,
        status: "active",
        lastMessageSequence: 0,
        wakePolicyJson: { ...CONVERSATION_WAKE_POLICY_DEFAULT },
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Add participants
    for (const agentId of input.participantAgentIds) {
      await db.insert(schema.conversationParticipants).values({
        companyId,
        conversationId: row.id,
        agentId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return getDetail(row.id, companyId, actor.userId);
  }

  async function update(
    companyId: string,
    actor: BoardActorEnvelope,
    input: UpdateConversationInput,
  ): Promise<ConversationDetail> {
    await ensureConversationVisible(input.conversationId, companyId);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.status !== undefined) updates.status = input.status;
    if (input.wakePolicy !== undefined) updates.wakePolicyJson = input.wakePolicy;

    await db
      .update(schema.conversations)
      .set(updates)
      .where(eq(schema.conversations.id, input.conversationId));

    return getDetail(input.conversationId, companyId, actor.userId);
  }

  async function listMessages(
    conversationId: string,
    companyId: string,
    input: ListConversationMessagesInput,
  ): Promise<ConversationMessagePage> {
    await ensureConversationVisible(conversationId, companyId);

    let conditions = [
      eq(schema.conversationMessages.conversationId, conversationId),
    ];

    if (input.beforeSequence) {
      conditions.push(
        lt(schema.conversationMessages.sequence, input.beforeSequence),
      );
    }

    if (input.q) {
      const escaped = escapeLikePattern(input.q);
      conditions.push(
        sql`${schema.conversationMessages.bodyMarkdown} ILIKE ${"%" + escaped + "%"}`,
      );
    }

    if (input.before) {
      conditions.push(
        lt(schema.conversationMessages.createdAt, new Date(input.before)),
      );
    }

    if (input.after) {
      conditions.push(
        gt(schema.conversationMessages.createdAt, new Date(input.after)),
      );
    }

    // If aroundMessageId, find that message and get surrounding context
    if (input.aroundMessageId) {
      const target = await db
        .select()
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, input.aroundMessageId))
        .limit(1)
        .then((r) => r[0]);

      if (target) {
        const half = Math.floor(input.limit / 2);
        const before = await db
          .select()
          .from(schema.conversationMessages)
          .where(
            and(
              eq(schema.conversationMessages.conversationId, conversationId),
              lt(schema.conversationMessages.sequence, target.sequence),
            ),
          )
          .orderBy(desc(schema.conversationMessages.sequence))
          .limit(half);

        const after = await db
          .select()
          .from(schema.conversationMessages)
          .where(
            and(
              eq(schema.conversationMessages.conversationId, conversationId),
              gt(schema.conversationMessages.sequence, target.sequence),
            ),
          )
          .orderBy(asc(schema.conversationMessages.sequence))
          .limit(half);

        const allRows = [...before.reverse(), target, ...after];
        const messages = await hydrateMessages(allRows, companyId);
        return {
          messages,
          hasMoreBefore: before.length === half,
          hasMoreAfter: after.length === half,
        };
      }
    }

    // If filtering by target, filter messages that have refs to that target
    if (input.targetKind && input.targetId) {
      const refMsgIds = await db
        .select({ messageId: schema.conversationMessageRefs.messageId })
        .from(schema.conversationMessageRefs)
        .where(
          and(
            eq(schema.conversationMessageRefs.refKind, input.targetKind),
            eq(schema.conversationMessageRefs.targetId, input.targetId),
          ),
        );
      const msgIdSet = new Set(refMsgIds.map((r) => r.messageId));
      if (msgIdSet.size > 0) {
        conditions.push(
          inArray(schema.conversationMessages.id, [...msgIdSet]),
        );
      } else {
        return { messages: [], hasMoreBefore: false, hasMoreAfter: false };
      }
    }

    const rows = await db
      .select()
      .from(schema.conversationMessages)
      .where(and(...conditions))
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(input.limit + 1);

    const hasMoreBefore = rows.length > input.limit;
    const trimmed = hasMoreBefore ? rows.slice(0, input.limit) : rows;
    const messages = await hydrateMessages(trimmed.reverse(), companyId);

    // Check hasMoreAfter: are there messages with sequence > our latest?
    let hasMoreAfter = false;
    if (messages.length > 0) {
      const latestSeq = messages[messages.length - 1].sequence;
      const conv = await db
        .select({ lastMessageSequence: schema.conversations.lastMessageSequence })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .limit(1)
        .then((r) => r[0]);
      if (conv && conv.lastMessageSequence > latestSeq) {
        hasMoreAfter = true;
      }
    }

    return {
      messages,
      hasMoreBefore,
      hasMoreAfter,
    };
  }

  async function createMessage(
    companyId: string,
    actor: BoardActorEnvelope,
    input: CreateConversationMessageInput,
  ): Promise<ConversationMessage> {
    const conv = await ensureConversationVisible(
      input.conversationId,
      companyId,
    );
    const now = new Date();

    // Increment sequence
    const newSequence = conv.lastMessageSequence + 1;

    // Parse inline mentions
    const mentionTokens = extractStructuredMentionTokens(input.bodyMarkdown);

    // Insert message
    const [msg] = await db
      .insert(schema.conversationMessages)
      .values({
        companyId,
        conversationId: input.conversationId,
        sequence: newSequence,
        parentId: input.parentId ?? null,
        authorType: "user",
        authorUserId: actor.userId,
        bodyMarkdown: input.bodyMarkdown,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Update conversation sequence and timestamp
    await db
      .update(schema.conversations)
      .set({ lastMessageSequence: newSequence, updatedAt: now })
      .where(eq(schema.conversations.id, input.conversationId));

    // Insert refs from inline mentions
    const refValues: (typeof schema.conversationMessageRefs.$inferInsert)[] = [];
    for (const token of mentionTokens) {
      refValues.push({
        companyId,
        messageId: msg.id,
        refKind: token.kind,
        targetId: token.targetId,
        displayText: token.displayText,
        refOrigin: "inline_mention",
        createdAt: now,
      });
    }

    // Insert refs from active context targets
    for (const target of input.activeContextTargets) {
      // Avoid duplicate if already mentioned inline
      const exists = refValues.some(
        (r) =>
          r.refKind === target.targetKind && r.targetId === target.targetId,
      );
      if (!exists) {
        refValues.push({
          companyId,
          messageId: msg.id,
          refKind: target.targetKind,
          targetId: target.targetId,
          displayText: target.displayText,
          refOrigin: "active_context",
          createdAt: now,
        });
      }
    }

    if (refValues.length > 0) {
      await db
        .insert(schema.conversationMessageRefs)
        .values(refValues)
        .onConflictDoNothing();
    }

    // Auto-create target links for ref targets
    const participantAgentIds = await getParticipantAgentIds(
      input.conversationId,
    );
    for (const ref of refValues) {
      if (ref.refKind === "agent") continue; // Agent refs don't create target links
      for (const agentId of participantAgentIds) {
        await db
          .insert(schema.conversationTargetLinks)
          .values({
            companyId,
            agentId,
            conversationId: input.conversationId,
            targetKind: ref.refKind,
            targetId: ref.targetId,
            displayText: ref.displayText,
            linkOrigin: "message_ref",
            latestLinkedMessageId: msg.id,
            latestLinkedMessageSequence: newSequence,
            createdByActorType: "user",
            createdByActorId: actor.userId ?? "system",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.conversationTargetLinks.agentId,
              schema.conversationTargetLinks.conversationId,
              schema.conversationTargetLinks.targetKind,
              schema.conversationTargetLinks.targetId,
            ],
            set: {
              latestLinkedMessageId: msg.id,
              latestLinkedMessageSequence: newSequence,
              updatedAt: now,
            },
          });

        // Remove suppression if present
        await db
          .delete(schema.conversationTargetSuppressions)
          .where(
            and(
              eq(schema.conversationTargetSuppressions.agentId, agentId),
              eq(
                schema.conversationTargetSuppressions.conversationId,
                input.conversationId,
              ),
              eq(schema.conversationTargetSuppressions.targetKind, ref.refKind),
              eq(schema.conversationTargetSuppressions.targetId, ref.targetId),
            ),
          );
      }
    }

    // Auto mark-read for the sender
    if (actor.userId) {
      await markReadInternal(
        input.conversationId,
        companyId,
        actor.userId,
        null,
        newSequence,
      );
    }

    const hydrated = await hydrateMessages([msg], companyId);
    return hydrated[0];
  }

  async function createAgentMessage(
    companyId: string,
    conversationId: string,
    agentId: string,
    bodyMarkdown: string,
    parentId: string | null,
    activeContextTargets: ConversationActiveContextTarget[],
    runId: string | null,
  ): Promise<ConversationMessage | null> {
    // Verify agent is still a participant
    const participant = await db
      .select()
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.agentId, agentId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!participant) {
      return null; // Late response rejection
    }

    const conv = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1)
      .then((r) => r[0]);

    if (!conv) return null;

    const now = new Date();
    const newSequence = conv.lastMessageSequence + 1;
    const mentionTokens = extractStructuredMentionTokens(bodyMarkdown);

    const [msg] = await db
      .insert(schema.conversationMessages)
      .values({
        companyId,
        conversationId,
        sequence: newSequence,
        parentId,
        authorType: "agent",
        authorAgentId: agentId,
        runId,
        bodyMarkdown,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db
      .update(schema.conversations)
      .set({ lastMessageSequence: newSequence, updatedAt: now })
      .where(eq(schema.conversations.id, conversationId));

    // Insert refs
    const refValues: (typeof schema.conversationMessageRefs.$inferInsert)[] = [];
    for (const token of mentionTokens) {
      refValues.push({
        companyId,
        messageId: msg.id,
        refKind: token.kind,
        targetId: token.targetId,
        displayText: token.displayText,
        refOrigin: "inline_mention",
        createdAt: now,
      });
    }
    for (const target of activeContextTargets) {
      const exists = refValues.some(
        (r) =>
          r.refKind === target.targetKind && r.targetId === target.targetId,
      );
      if (!exists) {
        refValues.push({
          companyId,
          messageId: msg.id,
          refKind: target.targetKind,
          targetId: target.targetId,
          displayText: target.displayText,
          refOrigin: "active_context",
          createdAt: now,
        });
      }
    }
    if (refValues.length > 0) {
      await db
        .insert(schema.conversationMessageRefs)
        .values(refValues)
        .onConflictDoNothing();
    }

    // Auto-create target links for agent's targets
    for (const ref of refValues) {
      if (ref.refKind === "agent") continue;
      await db
        .insert(schema.conversationTargetLinks)
        .values({
          companyId,
          agentId,
          conversationId,
          targetKind: ref.refKind,
          targetId: ref.targetId,
          displayText: ref.displayText,
          linkOrigin: "message_ref",
          latestLinkedMessageId: msg.id,
          latestLinkedMessageSequence: newSequence,
          createdByActorType: "agent",
          createdByActorId: agentId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.conversationTargetLinks.agentId,
            schema.conversationTargetLinks.conversationId,
            schema.conversationTargetLinks.targetKind,
            schema.conversationTargetLinks.targetId,
          ],
          set: {
            latestLinkedMessageId: msg.id,
            latestLinkedMessageSequence: newSequence,
            updatedAt: now,
          },
        });
    }

    // Auto mark read for the agent
    await markReadInternal(conversationId, companyId, null, agentId, newSequence);

    const hydrated = await hydrateMessages([msg], companyId);
    return hydrated[0];
  }

  async function deleteMessage(
    conversationId: string,
    messageId: string,
    companyId: string,
    actor: BoardActorEnvelope,
  ): Promise<{ messageId: string }> {
    await ensureConversationVisible(conversationId, companyId);

    const msg = await db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.id, messageId),
          eq(schema.conversationMessages.conversationId, conversationId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!msg) throw new Error("Message not found");
    if (msg.deletedAt) throw new Error("Message already deleted");

    // System messages cannot be deleted
    if (msg.authorType === "system") {
      throw new Error("System messages cannot be deleted");
    }

    // Authorization: board users can delete their own messages only
    if (actor.userId && msg.authorType === "user" && msg.authorUserId !== actor.userId) {
      throw new Error("Cannot delete another user's message");
    }

    // Collect affected refs before deletion for link sync
    const affectedRefs = await db
      .select()
      .from(schema.conversationMessageRefs)
      .where(eq(schema.conversationMessageRefs.messageId, messageId));

    // Tombstone: blank body, set deletedAt
    const now = new Date();
    await db
      .update(schema.conversationMessages)
      .set({
        bodyMarkdown: "",
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.conversationMessages.id, messageId));

    // Delete refs
    await db
      .delete(schema.conversationMessageRefs)
      .where(eq(schema.conversationMessageRefs.messageId, messageId));

    // Sync target links: for each affected target ref, check if any other
    // non-deleted message still references it; if not, remove the link
    const participantAgentIds = await getParticipantAgentIds(conversationId);
    const targetRefs = affectedRefs.filter((r) => r.refKind !== "agent");
    for (const ref of targetRefs) {
      for (const agentId of participantAgentIds) {
        await syncTargetLinkForPair(
          companyId,
          conversationId,
          agentId,
          ref.refKind,
          ref.targetId,
        );
      }
    }

    // Rebuild memory for all affected agent-target pairs
    if (targetRefs.length > 0) {
      const memSvc = conversationMemoryService(db);
      const memPairs = targetRefs.flatMap((ref) =>
        participantAgentIds.map((agentId) => ({
          agentId,
          targetKind: ref.refKind,
          targetId: ref.targetId,
        })),
      );
      memSvc.rebuildForPairs(companyId, memPairs).catch(() => {});
    }

    return { messageId };
  }

  /** Sync a single agent-target link: find latest non-deleted message
   *  with that target ref. If none exists, delete the link. */
  async function syncTargetLinkForPair(
    companyId: string,
    conversationId: string,
    agentId: string,
    targetKind: string,
    targetId: string,
  ): Promise<void> {
    // Find latest non-deleted message that has a ref to this target
    const latestRef = await db
      .select({
        messageId: schema.conversationMessageRefs.messageId,
        sequence: schema.conversationMessages.sequence,
      })
      .from(schema.conversationMessageRefs)
      .innerJoin(
        schema.conversationMessages,
        eq(schema.conversationMessageRefs.messageId, schema.conversationMessages.id),
      )
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conversationId),
          eq(schema.conversationMessageRefs.refKind, targetKind),
          eq(schema.conversationMessageRefs.targetId, targetId),
          isNull(schema.conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(1)
      .then((r) => r[0]);

    if (!latestRef) {
      // No remaining refs — delete the link
      await db
        .delete(schema.conversationTargetLinks)
        .where(
          and(
            eq(schema.conversationTargetLinks.agentId, agentId),
            eq(schema.conversationTargetLinks.conversationId, conversationId),
            eq(schema.conversationTargetLinks.targetKind, targetKind),
            eq(schema.conversationTargetLinks.targetId, targetId),
          ),
        );
    } else {
      // Update link to point to latest remaining message
      await db
        .update(schema.conversationTargetLinks)
        .set({
          latestLinkedMessageId: latestRef.messageId,
          latestLinkedMessageSequence: latestRef.sequence,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.conversationTargetLinks.agentId, agentId),
            eq(schema.conversationTargetLinks.conversationId, conversationId),
            eq(schema.conversationTargetLinks.targetKind, targetKind),
            eq(schema.conversationTargetLinks.targetId, targetId),
          ),
        );
    }
  }

  async function addParticipant(
    conversationId: string,
    agentId: string,
    companyId: string,
    actor: BoardActorEnvelope,
  ): Promise<ConversationParticipant> {
    await ensureConversationVisible(conversationId, companyId);
    const now = new Date();

    await db
      .insert(schema.conversationParticipants)
      .values({
        companyId,
        conversationId,
        agentId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .update(schema.conversations)
      .set({ updatedAt: now })
      .where(eq(schema.conversations.id, conversationId));

    const participants = await hydrateParticipants(conversationId, companyId);
    return participants.find((p) => p.agentId === agentId)!;
  }

  async function removeParticipant(
    conversationId: string,
    agentId: string,
    companyId: string,
    actor: BoardActorEnvelope,
  ): Promise<{ removedParticipantId: string }> {
    await ensureConversationVisible(conversationId, companyId);

    const participant = await db
      .select()
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.agentId, agentId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!participant) throw new Error("Participant not found");

    // Collect affected target links before deletion
    const affectedLinks = await db
      .select()
      .from(schema.conversationTargetLinks)
      .where(
        and(
          eq(schema.conversationTargetLinks.conversationId, conversationId),
          eq(schema.conversationTargetLinks.agentId, agentId),
        ),
      );

    // Delete participant
    await db
      .delete(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.id, participant.id));

    // Delete read states
    await db
      .delete(schema.conversationReadStates)
      .where(
        and(
          eq(schema.conversationReadStates.conversationId, conversationId),
          eq(schema.conversationReadStates.agentId, agentId),
        ),
      );

    // Delete target links
    await db
      .delete(schema.conversationTargetLinks)
      .where(
        and(
          eq(schema.conversationTargetLinks.conversationId, conversationId),
          eq(schema.conversationTargetLinks.agentId, agentId),
        ),
      );

    // Clear session mapping
    await db
      .delete(schema.conversationSessionMappings)
      .where(
        and(
          eq(schema.conversationSessionMappings.conversationId, conversationId),
          eq(schema.conversationSessionMappings.agentId, agentId),
        ),
      );

    // Cancel pending wakeup requests
    await db
      .update(schema.agentWakeupRequests)
      .set({
        status: "cancelled",
        error: "conversation_participant_removed",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.agentWakeupRequests.conversationId, conversationId),
          eq(schema.agentWakeupRequests.agentId, agentId),
          eq(schema.agentWakeupRequests.status, "pending"),
        ),
      );

    // Mark in-flight runs as revoked
    await db
      .update(schema.conversationRunRecords)
      .set({
        status: "revoked",
        error: "participant_removed",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationRunRecords.conversationId, conversationId),
          eq(schema.conversationRunRecords.agentId, agentId),
          inArray(schema.conversationRunRecords.status, [
            "starting",
            "streaming",
          ]),
        ),
      );

    // Best effort close host session
    try {
      const sessionMapping = await db
        .select()
        .from(schema.conversationSessionMappings)
        .where(
          and(
            eq(
              schema.conversationSessionMappings.conversationId,
              conversationId,
            ),
            eq(schema.conversationSessionMappings.agentId, agentId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (sessionMapping?.sessionId) {
        await ctx.agents.sessions.close(sessionMapping.sessionId, companyId);
      }
    } catch {
      // Best effort
    }

    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    return { removedParticipantId: participant.id };
  }

  async function markReadInternal(
    conversationId: string,
    companyId: string,
    userId: string | null,
    agentId: string | null,
    lastReadSequence: number,
  ): Promise<ConversationReadState | null> {
    if (!userId && !agentId) return null;
    const now = new Date();

    if (userId) {
      const [row] = await db
        .insert(schema.conversationReadStates)
        .values({
          companyId,
          conversationId,
          userId,
          lastReadSequence,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.conversationReadStates.conversationId,
            schema.conversationReadStates.userId,
          ],
          set: { lastReadSequence, updatedAt: now },
        })
        .returning();
      return {
        id: row.id,
        conversationId: row.conversationId,
        userId: row.userId,
        agentId: row.agentId,
        lastReadSequence: row.lastReadSequence,
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    if (agentId) {
      const [row] = await db
        .insert(schema.conversationReadStates)
        .values({
          companyId,
          conversationId,
          agentId,
          lastReadSequence,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.conversationReadStates.conversationId,
            schema.conversationReadStates.agentId,
          ],
          set: { lastReadSequence, updatedAt: now },
        })
        .returning();
      return {
        id: row.id,
        conversationId: row.conversationId,
        userId: row.userId,
        agentId: row.agentId,
        lastReadSequence: row.lastReadSequence,
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    return null;
  }

  async function markRead(
    conversationId: string,
    companyId: string,
    userId: string | null,
    lastReadSequence: number,
  ): Promise<ConversationReadState | null> {
    await ensureConversationVisible(conversationId, companyId);
    return markReadInternal(
      conversationId,
      companyId,
      userId,
      null,
      lastReadSequence,
    );
  }

  async function getReadState(
    conversationId: string,
    companyId: string,
    userId: string | null,
  ): Promise<ConversationReadState | null> {
    if (!userId) return null;
    const row = await db
      .select()
      .from(schema.conversationReadStates)
      .where(
        and(
          eq(schema.conversationReadStates.conversationId, conversationId),
          eq(schema.conversationReadStates.userId, userId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      agentId: row.agentId,
      lastReadSequence: row.lastReadSequence,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function linkTarget(
    companyId: string,
    actor: BoardActorEnvelope,
    input: CreateTargetLinkInput,
  ): Promise<{ linkedCount: number }> {
    await ensureConversationVisible(input.conversationId, companyId);
    const now = new Date();

    // Get anchor message for sequence
    const anchorMsg = await db
      .select()
      .from(schema.conversationMessages)
      .where(eq(schema.conversationMessages.id, input.anchorMessageId))
      .limit(1)
      .then((r) => r[0]);

    if (!anchorMsg) throw new Error("Anchor message not found");

    let linkedCount = 0;
    for (const agentId of input.agentIds) {
      await db
        .insert(schema.conversationTargetLinks)
        .values({
          companyId,
          agentId,
          conversationId: input.conversationId,
          targetKind: input.targetKind,
          targetId: input.targetId,
          linkOrigin: "manual",
          latestLinkedMessageId: input.anchorMessageId,
          latestLinkedMessageSequence: anchorMsg.sequence,
          createdByActorType: actor.actorType,
          createdByActorId: actor.userId ?? "system",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.conversationTargetLinks.agentId,
            schema.conversationTargetLinks.conversationId,
            schema.conversationTargetLinks.targetKind,
            schema.conversationTargetLinks.targetId,
          ],
          set: {
            linkOrigin: "manual",
            latestLinkedMessageId: input.anchorMessageId,
            latestLinkedMessageSequence: anchorMsg.sequence,
            updatedAt: now,
          },
        });

      // Remove suppression
      await db
        .delete(schema.conversationTargetSuppressions)
        .where(
          and(
            eq(schema.conversationTargetSuppressions.agentId, agentId),
            eq(
              schema.conversationTargetSuppressions.conversationId,
              input.conversationId,
            ),
            eq(
              schema.conversationTargetSuppressions.targetKind,
              input.targetKind,
            ),
            eq(
              schema.conversationTargetSuppressions.targetId,
              input.targetId,
            ),
          ),
        );

      linkedCount++;
    }

    // Rebuild memory for affected agent-target pairs
    const memSvc = conversationMemoryService(db);
    const memPairs = input.agentIds.map((agentId) => ({
      agentId,
      targetKind: input.targetKind,
      targetId: input.targetId,
    }));
    memSvc.rebuildForPairs(companyId, memPairs).catch(() => {});

    return { linkedCount };
  }

  async function unlinkTarget(
    companyId: string,
    actor: BoardActorEnvelope,
    input: DeleteTargetLinkInput,
  ): Promise<{ removedCount: number }> {
    const conv = await ensureConversationVisible(
      input.conversationId,
      companyId,
    );
    const now = new Date();
    let removedCount = 0;

    for (const agentId of input.agentIds) {
      const deleted = await db
        .delete(schema.conversationTargetLinks)
        .where(
          and(
            eq(schema.conversationTargetLinks.agentId, agentId),
            eq(
              schema.conversationTargetLinks.conversationId,
              input.conversationId,
            ),
            eq(
              schema.conversationTargetLinks.targetKind,
              input.targetKind,
            ),
            eq(schema.conversationTargetLinks.targetId, input.targetId),
          ),
        )
        .returning();

      if (deleted.length > 0) {
        removedCount += deleted.length;

        // Create suppression
        await db
          .insert(schema.conversationTargetSuppressions)
          .values({
            companyId,
            agentId,
            conversationId: input.conversationId,
            targetKind: input.targetKind,
            targetId: input.targetId,
            suppressedThroughMessageSequence: conv.lastMessageSequence,
            suppressedByActorType: actor.actorType,
            suppressedByActorId: actor.userId ?? "system",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.conversationTargetSuppressions.agentId,
              schema.conversationTargetSuppressions.conversationId,
              schema.conversationTargetSuppressions.targetKind,
              schema.conversationTargetSuppressions.targetId,
            ],
            set: {
              suppressedThroughMessageSequence: conv.lastMessageSequence,
              suppressedByActorType: actor.actorType,
              suppressedByActorId: actor.userId ?? "system",
              updatedAt: now,
            },
          });
      }
    }

    // Rebuild memory for affected agent-target pairs
    const memSvc = conversationMemoryService(db);
    const memPairs = input.agentIds.map((agentId) => ({
      agentId,
      targetKind: input.targetKind,
      targetId: input.targetId,
    }));
    memSvc.rebuildForPairs(companyId, memPairs).catch(() => {});

    return { removedCount };
  }

  async function getTargetLinks(
    conversationId: string,
    companyId: string,
  ): Promise<ConversationTargetLink[]> {
    await ensureConversationVisible(conversationId, companyId);
    const rows = await db
      .select()
      .from(schema.conversationTargetLinks)
      .where(eq(schema.conversationTargetLinks.conversationId, conversationId));

    return rows.map((tl) => ({
      id: tl.id,
      conversationId: tl.conversationId,
      agentId: tl.agentId,
      targetKind: tl.targetKind as "issue" | "goal" | "project",
      targetId: tl.targetId,
      displayText: tl.displayText,
      linkOrigin: tl.linkOrigin as "message_ref" | "manual" | "system",
      latestLinkedMessageId: tl.latestLinkedMessageId!,
      latestLinkedMessageSequence: tl.latestLinkedMessageSequence!,
      createdByActorType: tl.createdByActorType as "user" | "agent" | "system",
      createdByActorId: tl.createdByActorId,
      createdAt: tl.createdAt.toISOString(),
      updatedAt: tl.updatedAt.toISOString(),
    }));
  }

  async function getCostSummary(
    conversationId: string,
  ): Promise<ConversationCostSummary> {
    const rollups = await db
      .select()
      .from(schema.conversationRunTelemetryRollups)
      .where(
        eq(
          schema.conversationRunTelemetryRollups.conversationId,
          conversationId,
        ),
      );

    if (rollups.length === 0) {
      return {
        telemetryAvailable: false,
        spendCents: null,
        inputTokens: null,
        outputTokens: null,
        runCount: 0,
        lastOccurredAt: null,
      };
    }

    let totalSpend: number | null = null;
    let totalInput: number | null = null;
    let totalOutput: number | null = null;
    let runCount = 0;
    let lastOccurredAt: string | null = null;

    for (const r of rollups) {
      runCount += r.runCount;
      if (r.totalSpendCents != null) {
        totalSpend = (totalSpend ?? 0) + r.totalSpendCents;
      }
      if (r.totalInputTokens != null) {
        totalInput = (totalInput ?? 0) + r.totalInputTokens;
      }
      if (r.totalOutputTokens != null) {
        totalOutput = (totalOutput ?? 0) + r.totalOutputTokens;
      }
      if (
        r.lastOccurredAt &&
        (!lastOccurredAt || r.lastOccurredAt.toISOString() > lastOccurredAt)
      ) {
        lastOccurredAt = r.lastOccurredAt.toISOString();
      }
    }

    return {
      telemetryAvailable: true,
      spendCents: totalSpend,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      runCount,
      lastOccurredAt,
    };
  }

  async function getUiState(
    companyId: string,
    userId: string | null,
  ): Promise<ConversationUiState | null> {
    if (!userId) return null;
    const row = await db
      .select()
      .from(schema.conversationUiState)
      .where(
        and(
          eq(schema.conversationUiState.companyId, companyId),
          eq(schema.conversationUiState.userId, userId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!row) return null;
    return {
      lastConversationId: row.lastConversationId,
      lastTargetKind: row.lastTargetKind as "issue" | "goal" | "project" | null,
      lastTargetId: row.lastTargetId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function selectConversation(
    companyId: string,
    userId: string | null,
    conversationId: string | null,
    targetKind: string | null,
    targetId: string | null,
  ): Promise<ConversationUiState | null> {
    if (!userId) return null;
    const now = new Date();

    const [row] = await db
      .insert(schema.conversationUiState)
      .values({
        companyId,
        userId,
        lastConversationId: conversationId,
        lastTargetKind: targetKind,
        lastTargetId: targetId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.conversationUiState.companyId,
          schema.conversationUiState.userId,
        ],
        set: {
          lastConversationId: conversationId,
          lastTargetKind: targetKind,
          lastTargetId: targetId,
          updatedAt: now,
        },
      })
      .returning();

    return {
      lastConversationId: row.lastConversationId,
      lastTargetKind: row.lastTargetKind as "issue" | "goal" | "project" | null,
      lastTargetId: row.lastTargetId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function getAgentOptions(
    companyId: string,
    q?: string,
    includeTerminated?: boolean,
  ) {
    try {
      const agents = await ctx.agents.list({ companyId });
      let filtered = agents;
      if (!includeTerminated) {
        filtered = filtered.filter(
          (a) => a.status !== "terminated",
        );
      }
      if (q) {
        const lower = q.toLowerCase();
        filtered = filtered.filter(
          (a) =>
            (a.name ?? "").toLowerCase().includes(lower) ||
            a.id.toLowerCase().includes(lower),
        );
      }
      return filtered;
    } catch {
      return [];
    }
  }

  async function getTargetPickerOptions(
    companyId: string,
    q: string,
    allowedKinds?: string[],
  ): Promise<ConversationActiveContextTarget[]> {
    const results: ConversationActiveContextTarget[] = [];
    const kinds = allowedKinds ?? ["issue", "goal", "project"];
    const lower = q.toLowerCase();

    const scanBudget = { limit: 50, maxPages: 4 };

    // Search issues
    if (kinds.includes("issue")) {
      try {
        let offset = 0;
        for (let page = 0; page < scanBudget.maxPages; page++) {
          const issues = await ctx.issues.list({
            companyId,
            limit: scanBudget.limit,
            offset,
          });
          for (const issue of issues) {
            const identifier = (issue as unknown as { identifier?: string }).identifier ?? "";
            const title = issue.title ?? "";
            const text = `${identifier} ${title}`.toLowerCase();
            if (text.includes(lower)) {
              results.push({
                targetKind: "issue",
                targetId: issue.id,
                displayText: identifier ? `${identifier}: ${title}` : title,
              });
            }
          }
          if (issues.length < scanBudget.limit) break;
          offset += scanBudget.limit;
        }
      } catch {
        // ignore
      }
    }

    // Search goals
    if (kinds.includes("goal")) {
      try {
        let offset = 0;
        for (let page = 0; page < scanBudget.maxPages; page++) {
          const goals = await ctx.goals.list({
            companyId,
            limit: scanBudget.limit,
            offset,
          });
          for (const goal of goals) {
            const title = goal.title ?? "";
            if (title.toLowerCase().includes(lower)) {
              results.push({
                targetKind: "goal",
                targetId: goal.id,
                displayText: title,
              });
            }
          }
          if (goals.length < scanBudget.limit) break;
          offset += scanBudget.limit;
        }
      } catch {
        // ignore
      }
    }

    // Search projects
    if (kinds.includes("project")) {
      try {
        let offset = 0;
        for (let page = 0; page < scanBudget.maxPages; page++) {
          const projects = await ctx.projects.list({
            companyId,
            limit: scanBudget.limit,
            offset,
          });
          for (const project of projects) {
            const name = project.name ?? "";
            if (name.toLowerCase().includes(lower)) {
              results.push({
                targetKind: "project",
                targetId: project.id,
                displayText: name,
              });
            }
          }
          if (projects.length < scanBudget.limit) break;
          offset += scanBudget.limit;
        }
      } catch {
        // ignore
      }
    }

    // Rank: exact > prefix > substring; then by kind order, then displayText
    const kindOrder: Record<string, number> = { issue: 0, goal: 1, project: 2 };

    results.sort((a, b) => {
      const aText = a.displayText.toLowerCase();
      const bText = b.displayText.toLowerCase();

      const aExact = aText === lower ? 0 : aText.startsWith(lower) ? 1 : 2;
      const bExact = bText === lower ? 0 : bText.startsWith(lower) ? 1 : 2;

      if (aExact !== bExact) return aExact - bExact;
      const aKind = kindOrder[a.targetKind] ?? 3;
      const bKind = kindOrder[b.targetKind] ?? 3;
      if (aKind !== bKind) return aKind - bKind;
      return a.displayText.localeCompare(b.displayText);
    });

    return results;
  }

  return {
    list,
    getDetail,
    create,
    update,
    listMessages,
    createMessage,
    createAgentMessage,
    deleteMessage,
    addParticipant,
    removeParticipant,
    markRead,
    getReadState,
    linkTarget,
    unlinkTarget,
    getTargetLinks,
    getCostSummary,
    getUiState,
    selectConversation,
    getAgentOptions,
    getTargetPickerOptions,
    getParticipantAgentIds,
    ensureConversationVisible,
    markReadInternal,
  };
}
