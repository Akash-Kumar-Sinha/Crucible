import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export interface PostgresConfig {
  connectionString?: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

let prismaInstance: PrismaClient | null = null;
let pgPoolInstance: Pool | null = null;

export function getPostgresPool(config: PostgresConfig = {}): Pool {
  if (pgPoolInstance) {
    return pgPoolInstance;
  }

  const connectionString =
    config.connectionString ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    "postgresql://postgres:postgres@localhost:5432/crucible";

  pgPoolInstance = new Pool({
    connectionString,
    max: config.maxConnections ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 3000,
  });

  pgPoolInstance.on("error", (err) => {
    logger.error(
      { err },
      "[Crucible Postgres] Unexpected error on idle Postgres client pool",
    );
    getErrorReporter().captureAgentError(err, {
      component: "PostgresClientPool",
      alert: "CRUCIBLE_DATABASE_POOL_ERROR_ALERT",
    });
  });

  return pgPoolInstance;
}

export function getPrismaClient(config: PostgresConfig = {}): PrismaClient {
  if (prismaInstance) {
    return prismaInstance;
  }

  const pool = getPostgresPool(config);
  const adapter = new PrismaPg(pool);

  prismaInstance = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return prismaInstance;
}

export async function checkPostgresHealth(
  config: PostgresConfig = {},
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  try {
    const pool = getPostgresPool(config);
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      const latencyMs = Math.round(performance.now() - t0);
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - t0);
    logger.warn({ err, latencyMs }, "[Crucible Postgres] Health check failed");
    return { ok: false, latencyMs, error: err.message };
  }
}

export async function closePostgres(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
  if (pgPoolInstance) {
    await pgPoolInstance.end();
    pgPoolInstance = null;
  }
}
