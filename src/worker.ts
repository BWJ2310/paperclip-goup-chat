import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { bootstrapDatabase, type Db } from "./db/client.js";
import { conversationService } from "./services/conversations.js";
import { conversationMemoryService } from "./services/conversation-memory.js";
import { wakeService } from "./services/wake.js";
import type { BoardActorEnvelope, PluginRequest } from "./shared/types.js";
import {
  CreateConversationSchema,
  UpdateConversationSchema,
  CreateConversationMessageSchema,
  DeleteConversationMessageSchema,
  ListConversationsSchema,
  ListConversationMessagesSchema,
  MarkConversationReadSchema,
  AddParticipantSchema,
  RemoveParticipantSchema,
  CreateTargetLinkSchema,
  DeleteTargetLinkSchema,
  SelectConversationSchema,
  TargetPickerOptionsSchema,
} from "./shared/validators.js";
import type postgres from "postgres";

let db: Db | null = null;
let sqlClient: postgres.Sql | null = null;
let dbTarget: { mode: string; embeddedInstance?: unknown } | null = null;
let streamExpiryTimer: NodeJS.Timeout | null = null;
let isDegraded = false;

function parseActor(params: Record<string, unknown>): BoardActorEnvelope {
  const actor = params.actor as Record<string, unknown> | undefined;
  if (!actor || typeof actor !== "object") {
    throw new Error("Missing actor envelope");
  }
  const companyId = actor.companyId as string;
  if (!companyId) throw new Error("Missing actor.companyId");

  return {
    companyId,
    userId: (actor.userId as string) ?? null,
    actorType: "user",
    projectId: (actor.projectId as string) ?? null,
    entityId: (actor.entityId as string) ?? null,
    entityType: (actor.entityType as string) ?? null,
  };
}

function degradedError(): never {
  throw new Error(
    "Plugin database is not configured. Please configure database settings in plugin settings.",
  );
}

function emitInvalidation(
  ctx: PluginContext,
  conversationId: string,
  flags: {
    listChanged?: boolean;
    threadChanged?: boolean;
    readStateChanged?: boolean;
    telemetryChanged?: boolean;
  },
) {
  const revision = Date.now();

  // Emit to conversation-specific channel
  try {
    ctx.streams.emit(`conversation:${conversationId}`, {
      type: "conversation.invalidation",
      conversationId,
      revision,
      ...flags,
    });
  } catch {
    // ignore stream errors
  }

  // Emit to sidebar summary channel if list changed
  if (flags.listChanged) {
    try {
      ctx.streams.emit("conversations:sidebar", {
        type: "conversations.list.invalidation",
        conversationId,
        revision,
      });
    } catch {
      // ignore stream errors
    }
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    // Attempt database bootstrap
    try {
      const result = await bootstrapDatabase(ctx);
      db = result.db;
      sqlClient = result.sql;
      dbTarget = result.target;
      isDegraded = false;
      ctx.logger.info("Database bootstrapped successfully", {
        mode: result.target.mode,
      });
    } catch (err) {
      isDegraded = true;
      ctx.logger.warn("Database bootstrap failed - running in degraded mode", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Start stream expiry checker if DB is available
    if (db && !isDegraded) {
      const convSvc = conversationService(db, ctx);
      const wakeSvc = wakeService(db, ctx, convSvc, (convId, flags) =>
        emitInvalidation(ctx, convId, flags),
      );
      streamExpiryTimer = wakeSvc.startStreamExpiryChecker();

      // ── Data Handlers ──

      ctx.data.register(
        "conversation.list",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = ListConversationsSchema.parse(params.params ?? {});
          return convSvc.list(actor.companyId, actor.userId, input);
        },
      );

      ctx.data.register(
        "conversation.get",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as { conversationId: string };
          return convSvc.getDetail(p.conversationId, actor.companyId, actor.userId);
        },
      );

      ctx.data.register(
        "conversation.thread",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = ListConversationMessagesSchema.parse(params.params ?? {});
          return convSvc.listMessages(
            input.conversationId,
            actor.companyId,
            input,
          );
        },
      );

      ctx.data.register(
        "conversation.participants",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as { conversationId: string };
          const detail = await convSvc.getDetail(
            p.conversationId,
            actor.companyId,
            actor.userId,
          );
          return detail.participants;
        },
      );

      ctx.data.register(
        "conversation.agentOptions",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as {
            q?: string;
            includeTerminated?: boolean;
          };
          return convSvc.getAgentOptions(
            actor.companyId,
            p.q,
            p.includeTerminated,
          );
        },
      );

      ctx.data.register(
        "conversation.targetLinks",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as { conversationId: string };
          return convSvc.getTargetLinks(p.conversationId, actor.companyId);
        },
      );

      ctx.data.register(
        "conversation.targetPickerOptions",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = TargetPickerOptionsSchema.parse(params.params ?? {});
          return convSvc.getTargetPickerOptions(
            actor.companyId,
            input.q,
            input.allowedKinds,
          );
        },
      );

      ctx.data.register(
        "conversation.uiState",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          return convSvc.getUiState(actor.companyId, actor.userId);
        },
      );

      ctx.data.register(
        "conversation.readState",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as { conversationId: string };
          return convSvc.getReadState(
            p.conversationId,
            actor.companyId,
            actor.userId,
          );
        },
      );

      ctx.data.register(
        "conversation.costSummary",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const p = params.params as { conversationId: string };
          return convSvc.getCostSummary(p.conversationId);
        },
      );

      // ── Action Handlers ──

      ctx.actions.register(
        "conversation.create",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = CreateConversationSchema.parse(params.params ?? {});
          const result = await convSvc.create(actor.companyId, actor, input);
          emitInvalidation(ctx, result.id, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.update",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = UpdateConversationSchema.parse(params.params ?? {});
          const result = await convSvc.update(actor.companyId, actor, input);
          emitInvalidation(ctx, result.id, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.sendMessage",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = CreateConversationMessageSchema.parse(
            params.params ?? {},
          );
          const msg = await convSvc.createMessage(
            actor.companyId,
            actor,
            input,
          );
          emitInvalidation(ctx, input.conversationId, {
            listChanged: true,
            threadChanged: true,
          });

          // Async wake processing
          wakeSvc
            .processMessageWakes(
              input.conversationId,
              msg.id,
              actor.companyId,
            )
            .catch((err) => {
              ctx.logger.error("Wake processing failed", {
                error: String(err),
              });
            });

          // Async memory rebuild
          const memSvc = conversationMemoryService(db!);
          const msgRefs = msg.refs.filter((r) => r.refKind !== "agent");
          if (msgRefs.length > 0) {
            const agentIds = await convSvc.getParticipantAgentIds(
              input.conversationId,
            );
            const pairs = msgRefs.flatMap((ref) =>
              agentIds.map((agentId) => ({
                agentId,
                targetKind: ref.refKind,
                targetId: ref.targetId,
              })),
            );
            memSvc.rebuildForPairs(actor.companyId, pairs).catch(() => {});
          }

          return msg;
        },
      );

      ctx.actions.register(
        "conversation.deleteMessage",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = DeleteConversationMessageSchema.parse(
            params.params ?? {},
          );
          const result = await convSvc.deleteMessage(
            input.conversationId,
            input.messageId,
            actor.companyId,
            actor,
          );
          emitInvalidation(ctx, input.conversationId, {
            listChanged: true,
            threadChanged: true,
          });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.addParticipant",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = AddParticipantSchema.parse(params.params ?? {});
          const result = await convSvc.addParticipant(
            input.conversationId,
            input.agentId,
            actor.companyId,
            actor,
          );
          emitInvalidation(ctx, input.conversationId, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.removeParticipant",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = RemoveParticipantSchema.parse(params.params ?? {});
          const result = await convSvc.removeParticipant(
            input.conversationId,
            input.agentId,
            actor.companyId,
            actor,
          );
          emitInvalidation(ctx, input.conversationId, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.linkTarget",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = CreateTargetLinkSchema.parse(params.params ?? {});
          const result = await convSvc.linkTarget(
            actor.companyId,
            actor,
            input,
          );
          emitInvalidation(ctx, input.conversationId, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.unlinkTarget",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = DeleteTargetLinkSchema.parse(params.params ?? {});
          const result = await convSvc.unlinkTarget(
            actor.companyId,
            actor,
            input,
          );
          emitInvalidation(ctx, input.conversationId, { listChanged: true });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.markRead",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = MarkConversationReadSchema.parse(params.params ?? {});
          const result = await convSvc.markRead(
            input.conversationId,
            actor.companyId,
            actor.userId,
            input.lastReadSequence,
          );
          emitInvalidation(ctx, input.conversationId, {
            readStateChanged: true,
          });
          return result;
        },
      );

      ctx.actions.register(
        "conversation.selectConversation",
        async (params: Record<string, unknown>) => {
          if (isDegraded) degradedError();
          const actor = parseActor(params);
          const input = SelectConversationSchema.parse(params.params ?? {});
          return convSvc.selectConversation(
            actor.companyId,
            actor.userId,
            input.conversationId,
            input.targetKind,
            input.targetId,
          );
        },
      );

      // Open standard stream channels
      try {
        ctx.streams.open("conversations:sidebar", "");
      } catch {
        // Channel may already exist
      }
    }
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const c = config as Record<string, unknown>;
    const mode = (c.databaseMode as string) ?? "embedded-postgres";

    if (mode === "postgres") {
      if (!c.databaseConnectionStringSecretRef) {
        errors.push(
          'databaseConnectionStringSecretRef is required when databaseMode is "postgres"',
        );
      }
    } else if (mode !== "embedded-postgres") {
      errors.push(`Unknown databaseMode: ${mode}`);
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  },

  async onHealth() {
    if (isDegraded) {
      return {
        status: "degraded" as const,
        message:
          "Database not configured. Configure database settings in plugin settings.",
      };
    }
    return { status: "ok" as const, message: "Running" };
  },

  async onShutdown() {
    if (streamExpiryTimer) {
      clearInterval(streamExpiryTimer);
    }

    if (sqlClient) {
      try {
        await sqlClient.end();
      } catch {
        // ignore
      }
    }

    if (dbTarget?.embeddedInstance) {
      try {
        await (dbTarget.embeddedInstance as { stop(): Promise<void> }).stop();
      } catch {
        // ignore
      }
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
