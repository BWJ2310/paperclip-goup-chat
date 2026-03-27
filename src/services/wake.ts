import { createHash } from "node:crypto";
import { eq, and, desc, asc, gt, inArray, isNull, count, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  ConversationWakePolicy,
  ConversationActiveContextTarget,
  WakePacket,
} from "../shared/types.js";
import {
  CONVERSATION_WAKE_POLICY_DEFAULT,
  CONVERSATION_WAKE_POLICY_MAX_LEVELS,
} from "../shared/constants.js";
import {
  buildPluginConversationSessionTaskKey,
  buildPluginConversationSessionTaskKeyBase,
} from "../shared/task-key.js";
import { extractStructuredMentionIds } from "../shared/structured-mentions.js";
// ConversationReplyV1Schema removed — stdout-only mode, no JSON envelope expected
import { conversationMemoryService } from "./conversation-memory.js";
import type { conversationService } from "./conversations.js";

const SESSION_STREAM_TIMEOUT_MS = 31 * 60 * 1000; // 31 minutes
const SESSION_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface WakeCandidate {
  agentId: string;
  baseLevel: number;
}

export function wakeService(
  db: Db,
  ctx: PluginContext,
  convService: ReturnType<typeof conversationService>,
  emitInvalidation: (
    conversationId: string,
    flags: {
      listChanged?: boolean;
      threadChanged?: boolean;
      readStateChanged?: boolean;
      telemetryChanged?: boolean;
    },
  ) => void,
) {
  const memService = conversationMemoryService(db);

  // Active run tracking for stream correlation
  const activeRuns = new Map<
    string,
    {
      runRecordId: string;
      conversationId: string;
      agentId: string;
      companyId: string;
      wakeRequestId: string;
      stdoutChunks: string[];
      startedAt: number;
    }
  >();

  /**
   * Matches paperclip-dev wakeChancePercentForConversationLevel exactly.
   */
  function wakeChancePercentForLevel(
    wakePolicy: ConversationWakePolicy,
    level: number,
  ): number {
    const normalizedLevel = Math.max(1, Math.floor(level));
    const index = Math.min(normalizedLevel, wakePolicy.wakeChancePercents.length) - 1;
    return wakePolicy.wakeChancePercents[index] ?? 0;
  }

  /**
   * Matches paperclip-dev shouldTriggerConversationWakeForAgent exactly.
   * Uses SHA256 deterministic sampling.
   */
  function shouldTriggerWake(
    conversationId: string,
    sequence: number,
    agentId: string,
    level: number,
    wakePolicy: ConversationWakePolicy,
  ): boolean {
    const rate = wakeChancePercentForLevel(wakePolicy, level) / 100;
    if (rate <= 0) return false;
    if (rate >= 1) return true;

    const sample =
      parseInt(
        createHash("sha256")
          .update(`${conversationId}:${sequence}:${agentId}:${level}`)
          .digest("hex")
          .slice(0, 8),
        16,
      ) / 0x1_0000_0000;

    return sample < rate;
  }

  async function hasWakeCapacityForMessage(
    conversationId: string,
    authorType: string,
    _authorAgentId: string | null,
  ): Promise<boolean> {
    // User-authored messages always have capacity
    if (authorType === "user") return true;

    // For agent-authored: count TOTAL messages since last user message
    // (matches paperclip-dev hasConversationWakeCapacityForMessage)
    const lastUserMsg = await db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conversationId),
          eq(schema.conversationMessages.authorType, "user"),
          isNull(schema.conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(1)
      .then((r) => r[0]);

    const sinceSequence = lastUserMsg?.sequence ?? 0;

    // Count all messages since last user message
    const countResult = await db
      .select({ count: count() })
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conversationId),
          gt(schema.conversationMessages.sequence, sinceSequence),
          isNull(schema.conversationMessages.deletedAt),
        ),
      );

    const totalSinceReset = countResult[0]?.count ?? 0;

    // Capacity: total messages since last user < participant count
    const participants = await convService.getParticipantAgentIds(conversationId);
    return totalSinceReset < participants.length;
  }

  async function resolveWakeCandidates(
    conversationId: string,
    messageId: string,
    bodyMarkdown: string,
    parentId: string | null,
    authorType: string,
    authorAgentId: string | null,
  ): Promise<WakeCandidate[]> {
    const participantAgentIds =
      await convService.getParticipantAgentIds(conversationId);

    // Extract mentioned agents
    const mentionedAgentIds = extractStructuredMentionIds(
      bodyMarkdown,
      "agent",
    );

    // For threaded replies, resolve parent author as reply target
    let replyTargetAgentIds: string[] = [];
    if (parentId) {
      const parent = await db
        .select()
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, parentId))
        .limit(1)
        .then((r) => r[0]);
      if (parent?.authorAgentId) {
        replyTargetAgentIds = [parent.authorAgentId];
      }
    }

    // For agent-authored human-thread replies with no mentions and no reply targets:
    // suppress wakes
    if (
      authorType === "agent" &&
      parentId &&
      mentionedAgentIds.length === 0 &&
      replyTargetAgentIds.length === 0
    ) {
      return [];
    }

    const candidates: WakeCandidate[] = [];
    const seen = new Set<string>();

    // Remove acting agent from candidates
    const actingAgentId = authorType === "agent" ? authorAgentId : null;

    // EXCLUSIVE TIERS — matches paperclip-dev resolveConversationWakeRouting:
    // if mentions exist → ONLY mentioned agents wake at level 1
    // else if reply targets → ONLY reply targets wake at level 2
    // else → all participants wake at level 3

    const validMentioned = mentionedAgentIds.filter(
      (id) => id !== actingAgentId && participantAgentIds.includes(id),
    );
    const validReplyTargets = replyTargetAgentIds.filter(
      (id) => id !== actingAgentId && participantAgentIds.includes(id),
    );

    if (validMentioned.length > 0) {
      // Tier 1: only mentioned agents
      for (const agentId of validMentioned) {
        if (seen.has(agentId)) continue;
        seen.add(agentId);
        candidates.push({ agentId, baseLevel: 1 });
      }
    } else if (validReplyTargets.length > 0) {
      // Tier 2: only reply targets
      for (const agentId of validReplyTargets) {
        if (seen.has(agentId)) continue;
        seen.add(agentId);
        candidates.push({ agentId, baseLevel: 2 });
      }
    } else {
      // Tier 3: all remaining participants
      for (const agentId of participantAgentIds) {
        if (agentId === actingAgentId || seen.has(agentId)) continue;
        seen.add(agentId);
        candidates.push({ agentId, baseLevel: 3 });
      }
    }

    return candidates;
  }

  /**
   * Walk the agent hierarchy to compute distance from descendant to ancestor.
   * Matches paperclip-dev conversationAncestorDistance exactly.
   */
  function conversationAncestorDistance(
    descendantAgentId: string,
    ancestorAgentId: string,
    parentById: Map<string, string | null>,
  ): number | null {
    let distance = 0;
    let currentAgentId = descendantAgentId;
    const visited = new Set<string>();

    while (!visited.has(currentAgentId)) {
      visited.add(currentAgentId);
      const parentAgentId = parentById.get(currentAgentId) ?? null;
      if (!parentAgentId) return null;
      distance += 1;
      if (parentAgentId === ancestorAgentId) return distance;
      currentAgentId = parentAgentId;
    }

    return null;
  }

  /**
   * Build a parentById map from host agent data.
   */
  async function loadParentById(companyId: string): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    try {
      const agents = await ctx.agents.list({ companyId });
      for (const a of agents) {
        map.set(a.id, (a as unknown as { reportsTo: string | null }).reportsTo ?? null);
      }
    } catch {
      // fallback: no hierarchy data
    }
    return map;
  }

  /**
   * Compute the final wake level including agent step and hierarchy step.
   * Matches paperclip-dev toConversationWakeTargets exactly.
   */
  function computeFinalLevel(
    baseLevel: number,
    authorType: string,
    authorAgentId: string | null,
    targetAgentId: string,
    wakePolicy: ConversationWakePolicy,
    parentById: Map<string, string | null>,
  ): number {
    const actorStep = authorType === "agent" ? wakePolicy.agentHumanStep : 0;

    let hierarchyStep = 0;
    if (authorType === "agent" && authorAgentId) {
      const distance = conversationAncestorDistance(
        authorAgentId,
        targetAgentId,
        parentById,
      );
      if (distance !== null) {
        hierarchyStep = distance * wakePolicy.hierarchyStep;
      }
    }

    return Math.max(
      1,
      Math.min(
        baseLevel + actorStep + hierarchyStep,
        wakePolicy.wakeChancePercents.length,
      ),
    );
  }

  async function buildReplyContext(
    conversationId: string,
    companyId: string,
    triggeringMessageId: string,
    triggeringSequence: number,
    parentId: string | null,
  ): Promise<string> {
    const parts: string[] = [];

    // Parent summary if threaded
    if (parentId) {
      const parent = await db
        .select()
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, parentId))
        .limit(1)
        .then((r) => r[0]);
      if (parent && !parent.deletedAt) {
        const excerpt =
          parent.bodyMarkdown.length > 300
            ? parent.bodyMarkdown.slice(0, 300) + "…"
            : parent.bodyMarkdown;
        parts.push(`[Parent message (seq:${parent.sequence})]:\n${excerpt}\n`);
      }
    }

    // Recent prior messages (up to 3, excluding the trigger)
    const recentMsgs = await db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conversationId),
          lt(schema.conversationMessages.sequence, triggeringSequence),
          isNull(schema.conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(3);

    for (const msg of recentMsgs.reverse()) {
      const authorLabel =
        msg.authorType === "agent"
          ? `Agent(${msg.authorAgentId ?? "?"})`
          : msg.authorType === "user"
            ? "Board"
            : "System";
      const excerpt =
        msg.bodyMarkdown.length > 300
          ? msg.bodyMarkdown.slice(0, 300) + "…"
          : msg.bodyMarkdown;
      parts.push(`[${authorLabel} seq:${msg.sequence}]:\n${excerpt}\n`);
    }

    // The triggering message itself
    const triggerMsg = await db
      .select()
      .from(schema.conversationMessages)
      .where(eq(schema.conversationMessages.id, triggeringMessageId))
      .limit(1)
      .then((r) => r[0]);
    if (triggerMsg) {
      const authorLabel =
        triggerMsg.authorType === "agent"
          ? `Agent(${triggerMsg.authorAgentId ?? "?"})`
          : triggerMsg.authorType === "user"
            ? "Board"
            : "System";
      parts.push(
        `[${authorLabel} seq:${triggerMsg.sequence}] (triggering message):\n${triggerMsg.bodyMarkdown}\n`,
      );
    }

    return parts.join("\n---\n");
  }

  function buildPromptPacket(wake: WakePacket): string {
    const parts: string[] = [];

    parts.push(`CONVERSATION MODE — This is a direct Conversation with a board member (human user). Do NOT run heartbeat tasks, create files, delegate work, or perform any autonomous actions. Simply read the conversation below and reply naturally as yourself.`);
    parts.push(`\nIMPORTANT: Your ENTIRE stdout output will be posted as your reply message in the conversation. Keep your response concise, conversational, and directly relevant to what the user said. Do not create plans, tasks, or artifacts unless explicitly asked.`);

    if (wake.targetKind && wake.targetId) {
      parts.push(`\nThis conversation is linked to ${wake.targetKind}: ${wake.targetId}.`);
    }

    parts.push(`\n--- Conversation History ---\n${wake.replyContextMarkdown}`);

    if (wake.memoryMarkdown) {
      parts.push(`\n--- Related Context ---\n${wake.memoryMarkdown}`);
    }

    parts.push(`\nRespond to the latest message above. Be helpful, direct, and conversational. Do not run tools or create files unless the user explicitly asks you to.`);

    return parts.join("\n");
  }

  async function ensureSession(
    conversationId: string,
    agentId: string,
    companyId: string,
  ): Promise<{ sessionId: string; taskKey: string }> {
    const now = new Date();

    // Check for existing mapping
    let mapping: typeof schema.conversationSessionMappings.$inferSelect | null | undefined = await db
      .select()
      .from(schema.conversationSessionMappings)
      .where(
        and(
          eq(schema.conversationSessionMappings.conversationId, conversationId),
          eq(schema.conversationSessionMappings.agentId, agentId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (mapping && mapping.status === "active" && mapping.sessionId) {
      return { sessionId: mapping.sessionId, taskKey: mapping.taskKey };
    }

    // Check for stale creating state
    if (
      mapping &&
      mapping.status === "creating" &&
      mapping.lastCreateStartedAt
    ) {
      const elapsed =
        now.getTime() - mapping.lastCreateStartedAt.getTime();
      if (elapsed > SESSION_STALE_THRESHOLD_MS) {
        // Mark abandoned, will create new
        await db
          .update(schema.conversationSessionMappings)
          .set({ status: "abandoned", updatedAt: now })
          .where(eq(schema.conversationSessionMappings.id, mapping.id));
        mapping = null;
      } else {
        // Still creating, wait
        throw new Error("Session creation in progress");
      }
    }

    // Determine version
    let version = 1;
    if (mapping) {
      version = mapping.taskKeyVersion + 1;
    }

    const taskKey = buildPluginConversationSessionTaskKey(
      conversationId,
      agentId,
      version,
    );

    // Create or update mapping
    if (mapping) {
      await db
        .update(schema.conversationSessionMappings)
        .set({
          taskKey,
          taskKeyVersion: version,
          status: "creating",
          sessionId: null,
          lastCreateStartedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.conversationSessionMappings.id, mapping.id));
    } else {
      await db.insert(schema.conversationSessionMappings).values({
        companyId,
        conversationId,
        agentId,
        taskKey,
        taskKeyVersion: version,
        status: "creating",
        lastCreateStartedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create host session
    try {
      const session = await ctx.agents.sessions.create(agentId, companyId, {
        taskKey,
        reason: `Conversation wake for ${conversationId}`,
      });

      // Update mapping to active
      await db
        .update(schema.conversationSessionMappings)
        .set({
          sessionId: session.sessionId,
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.conversationSessionMappings.conversationId,
              conversationId,
            ),
            eq(schema.conversationSessionMappings.agentId, agentId),
            eq(schema.conversationSessionMappings.taskKey, taskKey),
          ),
        );

      return { sessionId: session.sessionId, taskKey };
    } catch (err) {
      // Mark create failed
      await db
        .update(schema.conversationSessionMappings)
        .set({
          status: "create_failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.conversationSessionMappings.conversationId,
              conversationId,
            ),
            eq(schema.conversationSessionMappings.agentId, agentId),
            eq(schema.conversationSessionMappings.taskKey, taskKey),
          ),
        );
      throw err;
    }
  }

  async function processMessageWakes(
    conversationId: string,
    messageId: string,
    companyId: string,
  ): Promise<void> {
    // Load the message
    const msg = await db
      .select()
      .from(schema.conversationMessages)
      .where(eq(schema.conversationMessages.id, messageId))
      .limit(1)
      .then((r) => r[0]);

    if (!msg) return;

    // Load conversation
    const conv = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1)
      .then((r) => r[0]);

    if (!conv || conv.status !== "active") return;

    const wakePolicy = (conv.wakePolicyJson as ConversationWakePolicy) ?? {
      ...CONVERSATION_WAKE_POLICY_DEFAULT,
    };

    // Check wake capacity
    const hasCapacity = await hasWakeCapacityForMessage(
      conversationId,
      msg.authorType,
      msg.authorAgentId,
    );
    if (!hasCapacity) return;

    // Resolve candidates
    const candidates = await resolveWakeCandidates(
      conversationId,
      messageId,
      msg.bodyMarkdown,
      msg.parentId,
      msg.authorType,
      msg.authorAgentId,
    );

    // Resolve active context targets for single-target wake
    const refs = await db
      .select()
      .from(schema.conversationMessageRefs)
      .where(eq(schema.conversationMessageRefs.messageId, messageId));

    const targetRefs = refs.filter(
      (r) => r.refKind !== "agent",
    );
    const singleTarget =
      targetRefs.length === 1
        ? { kind: targetRefs[0].refKind, id: targetRefs[0].targetId }
        : null;

    // Load agent hierarchy for hierarchy step computation
    const parentById = await loadParentById(companyId);

    for (const candidate of candidates) {
      const finalLevel = computeFinalLevel(
        candidate.baseLevel,
        msg.authorType,
        msg.authorAgentId,
        candidate.agentId,
        wakePolicy,
        parentById,
      );

      if (
        !shouldTriggerWake(
          conversationId,
          msg.sequence,
          candidate.agentId,
          finalLevel,
          wakePolicy,
        )
      ) {
        continue;
      }

      // Create wake request
      const now = new Date();
      const taskKeyBase = buildPluginConversationSessionTaskKeyBase(
        conversationId,
        candidate.agentId,
      );

      const replyContext = await buildReplyContext(
        conversationId,
        companyId,
        messageId,
        msg.sequence,
        msg.parentId,
      );

      // Get memory
      let memoryMarkdown: string | null = null;
      if (singleTarget) {
        memoryMarkdown = await memService.getMemory(
          candidate.agentId,
          singleTarget.kind,
          singleTarget.id,
        );
      }

      const [wakeRequest] = await db
        .insert(schema.agentWakeupRequests)
        .values({
          companyId,
          agentId: candidate.agentId,
          conversationId,
          conversationMessageId: messageId,
          conversationMessageSequence: msg.sequence,
          responseMode: "optional",
          source: "conversation_message",
          triggerDetail: `Message ${messageId} seq ${msg.sequence}`,
          reason: `Wake level ${finalLevel} for agent ${candidate.agentId}`,
          payload: {
            taskKeyBase,
            wakeLevel: finalLevel,
            targetKind: singleTarget?.kind ?? null,
            targetId: singleTarget?.id ?? null,
          },
          requestedByActorType: msg.authorType,
          requestedByActorId:
            msg.authorUserId ?? msg.authorAgentId ?? "system",
          idempotencyKey: `${conversationId}:${msg.sequence}:${candidate.agentId}`,
          status: "pending",
          requestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (!wakeRequest) continue; // Already exists (idempotent)

      // Dispatch the wake
      try {
        const { sessionId, taskKey } = await ensureSession(
          conversationId,
          candidate.agentId,
          companyId,
        );

        const wakePacket: WakePacket = {
          taskKey,
          conversationId,
          conversationMessageId: messageId,
          conversationMessageSequence: msg.sequence,
          conversationResponseMode: "optional",
          wakeLevel: finalLevel,
          agentId: candidate.agentId,
          targetKind: (singleTarget?.kind as "issue" | "goal" | "project") ?? null,
          targetId: singleTarget?.id ?? null,
          reason: wakeRequest.reason,
          source: "conversation_message",
          triggerDetail: wakeRequest.triggerDetail,
          replyContextMarkdown: replyContext,
          memoryMarkdown,
        };

        const prompt = buildPromptPacket(wakePacket);

        // Create provisional run record
        const [runRecord] = await db
          .insert(schema.conversationRunRecords)
          .values({
            companyId,
            conversationId,
            agentId: candidate.agentId,
            sessionId,
            wakeRequestId: wakeRequest.id,
            status: "starting",
            startedAt: now,
            lastEventAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // Register in-memory correlation
        const correlationKey = `${sessionId}:${runRecord.id}`;
        activeRuns.set(correlationKey, {
          runRecordId: runRecord.id,
          conversationId,
          agentId: candidate.agentId,
          companyId,
          wakeRequestId: wakeRequest.id,
          stdoutChunks: [],
          startedAt: now.getTime(),
        });

        // Claim wake request
        await db
          .update(schema.agentWakeupRequests)
          .set({
            status: "claimed",
            claimedAt: now,
            runId: runRecord.id,
            updatedAt: now,
          })
          .where(eq(schema.agentWakeupRequests.id, wakeRequest.id));

        // Send message
        const result = await ctx.agents.sessions.sendMessage(
          sessionId,
          companyId,
          {
            prompt,
            reason: `Conversation wake: ${conversationId}`,
            onEvent: (event) => {
              handleSessionEvent(correlationKey, sessionId, event);
            },
          },
        );

        // Update run with host runId
        if (result && typeof result === "object" && "runId" in result) {
          await db
            .update(schema.conversationRunRecords)
            .set({
              hostRunId: (result as { runId: string }).runId,
              status: "streaming",
              updatedAt: new Date(),
            })
            .where(eq(schema.conversationRunRecords.id, runRecord.id));
        }

        // Wait for completion is handled by event callbacks
      } catch (err) {
        // Mark wake as failed
        await db
          .update(schema.agentWakeupRequests)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.agentWakeupRequests.id, wakeRequest.id));
      }
    }
  }

  function handleSessionEvent(
    correlationKey: string,
    sessionId: string,
    event: {
      sessionId: string;
      runId: string;
      seq: number;
      eventType: string;
      stream: string | null;
      message: string | null;
      payload: Record<string, unknown> | null;
    },
  ): void {
    const run = activeRuns.get(correlationKey);
    if (!run) return;

    // Store raw telemetry event (fire and forget)
    db.insert(schema.conversationRunTelemetryEvents)
      .values({
        runRecordId: run.runRecordId,
        eventSeq: event.seq,
        eventType: event.eventType,
        stream: event.stream,
        message: event.message,
        payload: event.payload,
        occurredAt: new Date(),
      })
      .catch(() => {});

    // Update lastEventAt
    db.update(schema.conversationRunRecords)
      .set({ lastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversationRunRecords.id, run.runRecordId))
      .catch(() => {});

    // Buffer stdout chunks
    if (event.eventType === "chunk" && event.stream === "stdout" && event.message) {
      run.stdoutChunks.push(event.message);
    }

    // Terminal events
    if (event.eventType === "done" || event.eventType === "error") {
      handleRunCompletion(correlationKey, event.eventType === "error").catch(
        (err) => {
          ctx.logger.error("Run completion handler failed", { error: String(err) });
        },
      );
    }
  }

  async function handleRunCompletion(
    correlationKey: string,
    isError: boolean,
  ): Promise<void> {
    const run = activeRuns.get(correlationKey);
    if (!run) return;
    activeRuns.delete(correlationKey);

    const now = new Date();

    if (isError) {
      await db
        .update(schema.conversationRunRecords)
        .set({
          status: "failed",
          error: "session_error",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.conversationRunRecords.id, run.runRecordId));

      await db
        .update(schema.agentWakeupRequests)
        .set({
          status: "failed",
          error: "session_error",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));

      return;
    }

    // Extract reply from stdout — treat all stdout as the reply body
    const fullStdout = run.stdoutChunks.join("").trimEnd();

    if (!fullStdout) {
      await db.update(schema.conversationRunRecords)
        .set({ status: "completed_no_reply", finishedAt: now, updatedAt: now })
        .where(eq(schema.conversationRunRecords.id, run.runRecordId));
      await db.update(schema.agentWakeupRequests)
        .set({ status: "completed", finishedAt: now, updatedAt: now })
        .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));
      return;
    }

    // Parse stdout: extract text from opencode stream-json format.
    // Each stdout chunk is a line. Lines with {"type":"text",...,"part":{"text":"..."}}
    // contain the actual agent response text.
    const textParts: string[] = [];
    const lines = fullStdout.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      try {
        const obj = JSON.parse(trimmed);
        // opencode stream-json: type=text means the part.text is the response
        if (obj.type === "text" && obj.part?.text) {
          textParts.push(obj.part.text);
        }
      } catch {
        // Not JSON — skip (could be a [paperclip] log line)
      }
    }
    let replyBody = textParts.length > 0 ? textParts.join("") : fullStdout;
    replyBody = replyBody.trim();

    if (!replyBody) {
      await db.update(schema.conversationRunRecords)
        .set({ status: "completed_no_reply", finishedAt: now, updatedAt: now })
        .where(eq(schema.conversationRunRecords.id, run.runRecordId));
      await db.update(schema.agentWakeupRequests)
        .set({ status: "completed", finishedAt: now, updatedAt: now })
        .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));
      return;
    }

    // Persist the agent message
    const message = await convService.createAgentMessage(
      run.companyId,
      run.conversationId,
      run.agentId,
      replyBody,
      null,
      [],
      run.runRecordId,
    );

    if (!message) {
      await db.update(schema.conversationRunRecords)
        .set({ status: "rejected", error: "late_response_participant_removed", finishedAt: now, updatedAt: now })
        .where(eq(schema.conversationRunRecords.id, run.runRecordId));
      await db.update(schema.agentWakeupRequests)
        .set({ status: "failed", error: "late_response_rejected", finishedAt: now, updatedAt: now })
        .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));
      return;
    }

    // Update run/wake status
    await db.update(schema.conversationRunRecords)
      .set({ status: "completed", finishedAt: now, updatedAt: now })
      .where(eq(schema.conversationRunRecords.id, run.runRecordId));
    await db.update(schema.agentWakeupRequests)
      .set({ status: "completed", finishedAt: now, updatedAt: now })
      .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));

    // Update telemetry rollup
    await db.insert(schema.conversationRunTelemetryRollups)
      .values({
        companyId: run.companyId, conversationId: run.conversationId,
        agentId: run.agentId, runCount: 1, lastOccurredAt: now, updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.conversationRunTelemetryRollups.conversationId, schema.conversationRunTelemetryRollups.agentId],
        set: { runCount: sql`${schema.conversationRunTelemetryRollups.runCount} + 1`, lastOccurredAt: now, updatedAt: now },
      });

    // Emit invalidation
    emitInvalidation(run.conversationId, { listChanged: true, threadChanged: true, telemetryChanged: true });

    // Schedule memory rebuilds for affected targets
    const messageRefs = await db.select().from(schema.conversationMessageRefs)
      .where(eq(schema.conversationMessageRefs.messageId, message.id));
    const pairs = messageRefs
      .filter((r: { refKind: string }) => r.refKind !== "agent")
      .map((r: { refKind: string; targetId: string }) => ({ agentId: run.agentId, targetKind: r.refKind, targetId: r.targetId }));
    if (pairs.length > 0) {
      memService.rebuildForPairs(run.companyId, pairs).catch(() => {});
    }

    // Trigger wake chain for agent-authored messages
    processMessageWakes(run.conversationId, message.id, run.companyId).catch(() => {});
  }

  // Stream expiry checker
  function startStreamExpiryChecker(): NodeJS.Timeout {
    return setInterval(async () => {
      const now = Date.now();
      for (const [key, run] of activeRuns.entries()) {
        if (now - run.startedAt > SESSION_STREAM_TIMEOUT_MS) {
          activeRuns.delete(key);

          await db
            .update(schema.conversationRunRecords)
            .set({
              status: "stream_expired",
              error: "session_stream_timeout",
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.conversationRunRecords.id, run.runRecordId));

          await db
            .update(schema.agentWakeupRequests)
            .set({
              status: "failed",
              error: "session_stream_timeout",
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.agentWakeupRequests.id, run.wakeRequestId));

          // Clear session mapping
          await db
            .delete(schema.conversationSessionMappings)
            .where(
              and(
                eq(
                  schema.conversationSessionMappings.conversationId,
                  run.conversationId,
                ),
                eq(
                  schema.conversationSessionMappings.agentId,
                  run.agentId,
                ),
              ),
            );

          // Best effort close session
          try {
            const mapping = await db
              .select()
              .from(schema.conversationSessionMappings)
              .where(
                and(
                  eq(
                    schema.conversationSessionMappings.conversationId,
                    run.conversationId,
                  ),
                  eq(
                    schema.conversationSessionMappings.agentId,
                    run.agentId,
                  ),
                ),
              )
              .limit(1)
              .then((r) => r[0]);

            if (mapping?.sessionId) {
              await ctx.agents.sessions.close(
                mapping.sessionId,
                run.companyId,
              );
            }
          } catch {
            // Best effort
          }
        }
      }
    }, 60_000);
  }

  return {
    processMessageWakes,
    ensureSession,
    startStreamExpiryChecker,
    activeRuns,
  };
}
