import { getPostgresPool } from "./client";
import { logger } from "../../observability/logger";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function runPostgresMigrations(): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const migrationSqlPath = join(
      __dirname,
      "migrations",
      "0001_initial_schema.sql",
    );
    const sql = readFileSync(migrationSqlPath, "utf8");

    logger.info("[PostgresMigrator] Applying Crucible database migrations...");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    logger.info(
      "[PostgresMigrator] Database schema migrations applied successfully.",
    );
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "[PostgresMigrator] Database migration failed");
    throw err;
  } finally {
    client.release();
  }
}
