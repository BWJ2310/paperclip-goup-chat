export interface ConversationSummary {
  id: string; companyId: string; title: string; status: string;
  lastMessageSequence: number; latestMessageSequence: number; latestMessageAt: string | null;
  wakePolicy: WakePolicy; participants: Participant[];
  latestMessage: Message | null; unreadCount: number;
  createdAt: string; updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  costSummary: CostSummary;
  viewerReadState: ReadState | null;
  targetLinks: TargetLink[];
}

export interface Message {
  id: string; conversationId: string; sequence: number; parentId: string | null;
  authorType: string; authorUserId: string | null; authorAgentId: string | null;
  authorDisplayName: string | null; authorIcon: string | null; runId: string | null;
  bodyMarkdown: string; refs: MsgRef[]; parentSummary: string | null;
  deletedAt: string | null; createdAt: string; updatedAt: string;
}

export interface MsgRef {
  id: string; messageId: string; refKind: string; targetId: string;
  displayText: string; refOrigin: string;
}

export interface MessagePage {
  messages: Message[]; hasMoreBefore: boolean; hasMoreAfter: boolean;
}

export interface Participant {
  id: string; conversationId: string; agentId: string; agentName: string;
  agentIcon: string | null; agentRole: string | null; agentTitle: string | null;
  agentStatus: string | null; agentModel: string | null; agentThinkingEffort: string | null;
  joinedAt: string;
}

export interface ReadState { lastReadSequence: number; updatedAt: string }

export interface TargetLink {
  id: string; agentId: string; targetKind: string; targetId: string;
  displayText: string | null; linkOrigin: string;
}

export interface WakePolicy {
  agentHumanStep: number; hierarchyStep: number; wakeChancePercents: number[];
}

export interface CostSummary {
  telemetryAvailable: boolean; spendCents: number | null;
  inputTokens: number | null; outputTokens: number | null;
  runCount: number; lastOccurredAt: string | null;
}

export interface ActiveContextTarget {
  targetKind: string; targetId: string; displayText: string;
}

export interface Agent {
  id: string; name: string; status?: string; icon?: string | null;
}
