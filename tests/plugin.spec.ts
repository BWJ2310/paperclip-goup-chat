import { describe, it, expect, beforeAll } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";

describe("paperclip-plugin-chat", () => {
  describe("manifest", () => {
    it("should have correct id", () => {
      expect(manifest.id).toBe("paperclip-plugin-chat");
    });

    it("should have apiVersion 1", () => {
      expect(manifest.apiVersion).toBe(1);
    });

    it("should declare required capabilities", () => {
      expect(manifest.capabilities).toContain("ui.page.register");
      expect(manifest.capabilities).toContain("ui.sidebar.register");
      expect(manifest.capabilities).toContain("companies.read");
      expect(manifest.capabilities).toContain("agents.read");
      expect(manifest.capabilities).toContain("agent.sessions.create");
      expect(manifest.capabilities).toContain("agent.sessions.send");
      expect(manifest.capabilities).toContain("secrets.read-ref");
    });

    it("should declare page slot with conversations routePath", () => {
      const pageSlot = manifest.ui?.slots?.find((s) => s.type === "page");
      expect(pageSlot).toBeDefined();
      expect(pageSlot?.routePath).toBe("conversations");
      expect(pageSlot?.exportName).toBe("ConversationsPage");
    });

    it("should declare sidebar slot", () => {
      const sidebarSlot = manifest.ui?.slots?.find(
        (s) => s.type === "sidebar",
      );
      expect(sidebarSlot).toBeDefined();
      expect(sidebarSlot?.exportName).toBe("ConversationsSidebar");
    });

    it("should not declare sidebarPanel slot (single sidebar entry matches paperclip-dev)", () => {
      const panelSlot = manifest.ui?.slots?.find(
        (s) => s.type === "sidebarPanel",
      );
      expect(panelSlot).toBeUndefined();
    });

    it("should have instanceConfigSchema with database settings", () => {
      const schema = manifest.instanceConfigSchema as Record<string, unknown>;
      expect(schema).toBeDefined();
      const props = schema.properties as Record<string, unknown>;
      expect(props.databaseMode).toBeDefined();
      expect(props.databaseConnectionStringSecretRef).toBeDefined();
    });
  });

  describe("shared contracts", () => {
    it("should export structured mention parsing", async () => {
      const { extractStructuredMentionTokens } = await import(
        "../src/shared/structured-mentions.js"
      );
      const tokens = extractStructuredMentionTokens(
        "Hello [Agent1](agent://abc-123) and [Issue](issue://def-456)",
      );
      expect(tokens).toHaveLength(2);
      expect(tokens[0].kind).toBe("agent");
      expect(tokens[0].targetId).toBe("abc-123");
      expect(tokens[1].kind).toBe("issue");
      expect(tokens[1].targetId).toBe("def-456");
    });

    it("should build plugin task keys", async () => {
      const { buildPluginConversationSessionTaskKey } = await import(
        "../src/shared/task-key.js"
      );
      const key = buildPluginConversationSessionTaskKey(
        "conv-1",
        "agent-1",
        1,
      );
      expect(key).toBe(
        "plugin:paperclip-plugin-chat:session:conv-1:agent-1:v1",
      );
    });

    it("should validate CreateConversation input", async () => {
      const { CreateConversationSchema } = await import(
        "../src/shared/validators.js"
      );
      const valid = CreateConversationSchema.safeParse({
        title: "Test",
        participantAgentIds: [
          "00000000-0000-0000-0000-000000000001",
          "00000000-0000-0000-0000-000000000001",
        ],
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        // Should dedupe
        expect(valid.data.participantAgentIds).toHaveLength(1);
      }
    });

    it("should validate ConversationReplyV1", async () => {
      const { ConversationReplyV1Schema } = await import(
        "../src/shared/validators.js"
      );
      const valid = ConversationReplyV1Schema.safeParse({
        kind: "conversation.reply.v1",
        bodyMarkdown: "Hello",
        parentId: null,
        activeContextTargets: [],
        manualTargetLinks: [],
      });
      expect(valid.success).toBe(true);
    });

    it("should reject invalid ConversationReplyV1", async () => {
      const { ConversationReplyV1Schema } = await import(
        "../src/shared/validators.js"
      );
      const invalid = ConversationReplyV1Schema.safeParse({
        kind: "wrong",
        bodyMarkdown: "Hello",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("constants", () => {
    it("should export wake policy defaults", async () => {
      const {
        CONVERSATION_WAKE_POLICY_DEFAULT,
        CONVERSATION_WAKE_POLICY_MAX_LEVELS,
      } = await import("../src/shared/constants.js");
      expect(CONVERSATION_WAKE_POLICY_DEFAULT.agentHumanStep).toBe(1);
      expect(CONVERSATION_WAKE_POLICY_DEFAULT.hierarchyStep).toBe(1);
      expect(CONVERSATION_WAKE_POLICY_DEFAULT.wakeChancePercents).toEqual([
        100, 70, 50,
      ]);
      expect(CONVERSATION_WAKE_POLICY_MAX_LEVELS).toBe(10);
    });
  });
});
