import pg from "pg";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __discorpPool: pg.Pool | undefined;
}

/**
 * Raw PostgreSQL pool used exclusively for pgvector operations
 * (Prisma cannot run vector similarity queries natively).
 */
export const pool: pg.Pool =
  global.__discorpPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  global.__discorpPool = pool;
}

export type { Pool } from "pg";
