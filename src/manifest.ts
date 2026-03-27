import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-plugin-chat",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Conversations",
  description:
    "Multi-agent conversation system with structured mentions, target linking, and contextual memory",
  author: "Paperclip",
  categories: ["ui", "automation"],

  capabilities: [
    "ui.page.register",
    "ui.sidebar.register",
    "companies.read",
    "projects.read",
    "issues.read",
    "agents.read",
    "goals.read",
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    "secrets.read-ref",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  instanceConfigSchema: {
    type: "object",
    properties: {
      databaseMode: {
        type: "string",
        enum: ["embedded-postgres", "postgres"],
        default: "embedded-postgres",
        title: "Database Mode",
        description:
          "Use embedded PostgreSQL (automatic) or connect to an external PostgreSQL database.",
      },
      databaseConnectionStringSecretRef: {
        type: "string",
        format: "secret-ref",
        title: "Database Connection String (Secret Ref)",
        description:
          'Secret reference for the PostgreSQL connection string. Only needed when databaseMode is "postgres".',
      },
    },
    additionalProperties: false,
  },

  ui: {
    slots: [
      {
        type: "page",
        id: "conversations-page",
        displayName: "Conversations",
        exportName: "ConversationsPage",
        routePath: "conversations",
      },
      {
        type: "sidebar",
        id: "conversations-sidebar",
        displayName: "Conversations",
        exportName: "ConversationsSidebar",
      },
    ],
  },
};

export default manifest;
