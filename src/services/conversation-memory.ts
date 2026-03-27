import { eq, and, gt, desc, asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";

export function conversationMemoryService(db: Db) {
  async function rebuildForTarget(
    companyId: string,
    agentId: string,
    targetKind: string,
    targetId: string,
  ): Promise<void> {
    const now = new Date();

    try {
      // Find all linked conversations for this agent-target pair
      const links = await db
        .select()
        .from(schema.conversationTargetLinks)
        .where(
          and(
            eq(schema.conversationTargetLinks.agentId, agentId),
            eq(schema.conversationTargetLinks.targetKind, targetKind),
            eq(schema.conversationTargetLinks.targetId, targetId),
            eq(schema.conversationTargetLinks.companyId, companyId),
          ),
        );

      if (links.length === 0) {
        // No links - delete memory row
        await db
          .delete(schema.agentTargetConversationMemory)
          .where(
            and(
              eq(schema.agentTargetConversationMemory.agentId, agentId),
              eq(schema.agentTargetConversationMemory.targetKind, targetKind),
              eq(schema.agentTargetConversationMemory.targetId, targetId),
            ),
          );
        return;
      }

      // Mark as rebuilding
      await db
        .insert(schema.agentTargetConversationMemory)
        .values({
          companyId,
          agentId,
          targetKind,
          targetId,
          buildStatus: "rebuilding",
          memoryMarkdown: "",
          lastRebuiltAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.agentTargetConversationMemory.agentId,
            schema.agentTargetConversationMemory.targetKind,
            schema.agentTargetConversationMemory.targetId,
          ],
          set: { buildStatus: "rebuilding", updatedAt: now },
        });

      const conversationIds = [...new Set(links.map((l) => l.conversationId))];

      // Load suppressions
      const suppressions = await db
        .select()
        .from(schema.conversationTargetSuppressions)
        .where(
          and(
            eq(schema.conversationTargetSuppressions.agentId, agentId),
            eq(schema.conversationTargetSuppressions.targetKind, targetKind),
            eq(schema.conversationTargetSuppressions.targetId, targetId),
          ),
        );
      const suppressionMap = new Map<string, number>();
      for (const s of suppressions) {
        suppressionMap.set(
          s.conversationId,
          s.suppressedThroughMessageSequence,
        );
      }

      // Load message refs that mention this target across linked conversations
      const refs = await db
        .select({
          messageId: schema.conversationMessageRefs.messageId,
          conversationId: schema.conversationMessages.conversationId,
          sequence: schema.conversationMessages.sequence,
          bodyMarkdown: schema.conversationMessages.bodyMarkdown,
          authorType: schema.conversationMessages.authorType,
          authorAgentId: schema.conversationMessages.authorAgentId,
          createdAt: schema.conversationMessages.createdAt,
          deletedAt: schema.conversationMessages.deletedAt,
        })
        .from(schema.conversationMessageRefs)
        .innerJoin(
          schema.conversationMessages,
          eq(
            schema.conversationMessageRefs.messageId,
            schema.conversationMessages.id,
          ),
        )
        .where(
          and(
            eq(schema.conversationMessageRefs.refKind, targetKind),
            eq(schema.conversationMessageRefs.targetId, targetId),
            inArray(
              schema.conversationMessages.conversationId,
              conversationIds,
            ),
          ),
        )
        .orderBy(
          asc(schema.conversationMessages.conversationId),
          asc(schema.conversationMessages.sequence),
        )
        .limit(50);

      // Filter by suppression and deleted
      const validRefs = refs.filter((r) => {
        if (r.deletedAt) return false;
        const sup = suppressionMap.get(r.conversationId);
        if (sup !== undefined && r.sequence <= sup) return false;
        return true;
      });

      // Load conversation titles
      const convRows = await db
        .select({ id: schema.conversations.id, title: schema.conversations.title })
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, conversationIds));
      const convTitleMap = new Map(convRows.map((c) => [c.id, c.title]));

      // Build markdown
      const sections: string[] = [];
      sections.push(`## Linked Conversations for ${targetKind}:${targetId}\n`);

      for (const convId of conversationIds) {
        const title = convTitleMap.get(convId) ?? convId;
        const convRefs = validRefs.filter((r) => r.conversationId === convId);
        sections.push(`### ${title}\n`);

        for (const ref of convRefs) {
          const excerpt =
            ref.bodyMarkdown.length > 400
              ? ref.bodyMarkdown.slice(0, 400) + "…"
              : ref.bodyMarkdown;
          const authorLabel =
            ref.authorType === "agent"
              ? `Agent ${ref.authorAgentId ?? ""}`
              : ref.authorType === "user"
                ? "Board"
                : "System";
          sections.push(
            `> [seq:${ref.sequence}] ${authorLabel}: ${excerpt}\n`,
          );
        }
      }

      const memoryMarkdown = sections.join("\n");
      let lastSeq = 0;
      let latestAt: Date | null = null;

      for (const r of validRefs) {
        if (r.sequence > lastSeq) lastSeq = r.sequence;
        if (!latestAt || r.createdAt > latestAt) latestAt = r.createdAt;
      }

      await db
        .update(schema.agentTargetConversationMemory)
        .set({
          memoryMarkdown,
          buildStatus: "ready",
          linkedConversationCount: conversationIds.length,
          linkedMessageCount: validRefs.length,
          sourceMessageCount: validRefs.length,
          lastSourceMessageSequence: lastSeq,
          latestSourceMessageAt: latestAt,
          lastBuildError: null,
          lastRebuiltAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.agentTargetConversationMemory.agentId, agentId),
            eq(schema.agentTargetConversationMemory.targetKind, targetKind),
            eq(schema.agentTargetConversationMemory.targetId, targetId),
          ),
        );
    } catch (err) {
      await db
        .update(schema.agentTargetConversationMemory)
        .set({
          buildStatus: "failed",
          lastBuildError:
            err instanceof Error ? err.message : String(err),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.agentTargetConversationMemory.agentId, agentId),
            eq(schema.agentTargetConversationMemory.targetKind, targetKind),
            eq(schema.agentTargetConversationMemory.targetId, targetId),
          ),
        );
    }
  }

  async function rebuildForPairs(
    companyId: string,
    pairs: Array<{ agentId: string; targetKind: string; targetId: string }>,
  ): Promise<void> {
    // Dedupe
    const seen = new Set<string>();
    const unique = pairs.filter((p) => {
      const key = `${p.agentId}:${p.targetKind}:${p.targetId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const pair of unique) {
      await rebuildForTarget(
        companyId,
        pair.agentId,
        pair.targetKind,
        pair.targetId,
      );
    }
  }

  async function getMemory(
    agentId: string,
    targetKind: string,
    targetId: string,
  ): Promise<string | null> {
    const row = await db
      .select()
      .from(schema.agentTargetConversationMemory)
      .where(
        and(
          eq(schema.agentTargetConversationMemory.agentId, agentId),
          eq(schema.agentTargetConversationMemory.targetKind, targetKind),
          eq(schema.agentTargetConversationMemory.targetId, targetId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    return row?.memoryMarkdown ?? null;
  }

  return { rebuildForTarget, rebuildForPairs, getMemory };
}
