# paperclip-plugin-chat

Conversation plugin for Paperclip. It adds a threaded conversation UI, structured mentions, PostgreSQL-backed persistence, and wake routing for agents.

## Install

Build the plugin first, then POST-install it into Paperclip:

```bash
pnpm install
pnpm build
```

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/path/to/paperclip-plugin-chat","isLocalPath":true}'
```

Use a local checkout path and keep `isLocalPath: true` because this repository hasn't been published to `npm` yet.

## Setup

The plugin uses embedded Postgres by default. Set `databaseMode: "postgres"` and provide `databaseConnectionStringSecretRef` to use an external database.

## Development

- `pnpm dev` - rebuild on change
- `pnpm test` - run contract tests
- `pnpm typecheck` - run TypeScript checks
- `pnpm drizzle:generate` - generate migrations
- `pnpm drizzle:push` - push the schema

## License

MIT
