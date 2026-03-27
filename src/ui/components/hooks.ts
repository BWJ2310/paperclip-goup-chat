import { useMemo } from "react";
import { useHostContext } from "@paperclipai/plugin-sdk/ui";

export function useActor() {
  const ctx = useHostContext();
  return useMemo(() => ({
    companyId: ctx.companyId ?? "",
    userId: ctx.userId ?? null,
    actorType: "user" as const,
    projectId: ctx.projectId ?? null,
    entityId: ctx.entityId ?? null,
    entityType: ctx.entityType ?? null,
  }), [ctx.companyId, ctx.userId, ctx.projectId, ctx.entityId, ctx.entityType]);
}

export function resolveAuthor(
  msg: { authorType: string; authorUserId: string | null; authorAgentId: string | null; authorDisplayName: string | null },
  uid: string | null,
  names: Map<string, string>,
): string {
  if (msg.authorType === "agent" && msg.authorAgentId) return names.get(msg.authorAgentId) ?? msg.authorDisplayName ?? "Agent";
  if (msg.authorType === "user") return msg.authorUserId && uid === msg.authorUserId ? "You" : msg.authorDisplayName ?? "Board";
  return "System";
}
