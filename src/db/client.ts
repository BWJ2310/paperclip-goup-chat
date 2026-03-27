import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseTarget {
  mode: "embedded-postgres" | "postgres";
  connectionString: string;
  embeddedInstance?: unknown;
}

interface PluginConfig {
  databaseMode?: string;
  databaseConnectionStringSecretRef?: string;
  embeddedPostgresDataDir?: string;
  embeddedPostgresPort?: number;
}

/**
 * Resolve the default embedded-postgres data directory relative to the plugin
 * package root, mirroring how paperclip-master keeps its embedded-postgres
 * data under the project's own directory tree.
 */
function resolveDefaultDataDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // After esbuild bundling, thisFile is <pluginRoot>/dist/worker.js
  // Go up one level from dist/ to reach <pluginRoot>
  const pluginRoot = path.resolve(path.dirname(thisFile), "..");
  return path.join(pluginRoot, "db");
}

export async function resolveDatabaseTarget(
  ctx: PluginContext,
): Promise<DatabaseTarget> {
  const config = (await ctx.config.get()) as PluginConfig | null;
  const mode = config?.databaseMode ?? "embedded-postgres";

  if (mode === "postgres") {
    const secretRef = config?.databaseConnectionStringSecretRef;
    if (!secretRef) {
      throw new Error(
        'databaseConnectionStringSecretRef is required when databaseMode is "postgres"',
      );
    }
    const connectionString = await ctx.secrets.resolve(secretRef);
    if (!connectionString) {
      throw new Error(
        `Failed to resolve secret ref: ${secretRef}`,
      );
    }
    return { mode: "postgres", connectionString };
  }

  // embedded-postgres mode: try to start a dedicated instance,
  // or fall back to the host's running embedded postgres (port 54329)
  const dataDir = config?.embeddedPostgresDataDir || resolveDefaultDataDir();
  const port = config?.embeddedPostgresPort ?? 5435;
  let connectionString: string;
  let embeddedInstance: unknown = undefined;

  // Set LD_LIBRARY_PATH for embedded-postgres binaries (ICU libs)
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const epPkgPath = req.resolve("@embedded-postgres/linux-x64/package.json");
    const libDir = path.resolve(path.dirname(epPkgPath), "native", "lib");
    const cur = process.env.LD_LIBRARY_PATH ?? "";
    if (!cur.includes(libDir)) {
      process.env.LD_LIBRARY_PATH = cur ? `${libDir}:${cur}` : libDir;
    }
  } catch { /* ok */ }

  try {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const pg = new EmbeddedPostgres({ databaseDir: dataDir, port, persistent: true });
    try { await pg.initialise(); } catch { /* may already exist */ }
    await pg.start();
    embeddedInstance = pg;
    connectionString = `postgresql://postgres:password@localhost:${port}/postgres`;
  } catch {
    // Fallback: try to use the host's embedded postgres on port 54329
    connectionString = `postgresql://paperclip:paperclip@localhost:54329/paperclip`;
  }

  // Ensure a dedicated plugin database exists
  const adminSql = postgres(connectionString);
  try {
    const exists = await adminSql`SELECT 1 FROM pg_database WHERE datname = 'paperclip_plugin_chat'`;
    if (exists.length === 0) {
      await adminSql.unsafe("CREATE DATABASE paperclip_plugin_chat");
    }
  } catch {
    // DB might already exist or we don't have CREATE DATABASE privileges — try connecting directly
  } finally {
    await adminSql.end();
  }

  // Connect to the plugin-specific database
  const pluginCs = connectionString.replace(/\/[^/]*$/, "/paperclip_plugin_chat");
  return { mode: "embedded-postgres", connectionString: pluginCs, embeddedInstance };
}

export function createDb(connectionString: string): {
  db: Db;
  sql: postgres.Sql;
} {
  const sqlClient = postgres(connectionString);
  const db = drizzle(sqlClient, { schema });
  return { db, sql: sqlClient };
}

export async function runMigrations(db: Db): Promise<void> {
  // After esbuild bundling, import.meta.url is dist/worker.js
  // Migrations are in src/db/migrations/ — resolve from plugin root
  const workerFile = fileURLToPath(import.meta.url);
  const pluginRoot = path.resolve(path.dirname(workerFile), "..");
  const migrationsFolder = path.join(pluginRoot, "src", "db", "migrations");
  await migrate(db, { migrationsFolder });
}

export async function bootstrapDatabase(ctx: PluginContext): Promise<{
  db: Db;
  sql: postgres.Sql;
  target: DatabaseTarget;
}> {
  const target = await resolveDatabaseTarget(ctx);
  const { db, sql } = createDb(target.connectionString);
  await runMigrations(db);
  return { db, sql, target };
}
