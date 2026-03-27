export function buildPluginConversationSessionTaskKey(
  conversationId: string,
  agentId: string,
  version: number = 1,
): string {
  return `plugin:paperclip-plugin-chat:session:${conversationId}:${agentId}:v${version}`;
}

export function buildPluginConversationSessionTaskKeyBase(
  conversationId: string,
  agentId: string,
): string {
  return `plugin:paperclip-plugin-chat:session:${conversationId}:${agentId}`;
}
