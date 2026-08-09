import { MemoryKind, type Prisma } from "@prisma/client";
import { pool } from "../database/vector.js";
import { prisma } from "../database/prisma.js";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";

const DIM = env.AI_EMBEDDING_DIM;

export interface MemoryRecord {
  id: string;
  guildId: string;
  agentId: string | null;
  kind: MemoryKind;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  /** 0..1 similarity, only present on search results */
  similarity?: number;
}

function vectorLiteral(embedding: number[]): string {
  return `'[${embedding.join(",")}]'`;
}

/** Store a memory item with its embedding. */
export async function storeMemory(input: {
  guildId: string;
  agentId?: string;
  kind: MemoryKind;
  content: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
}): Promise<MemoryRecord> {
  if (input.embedding.length !== DIM) {
    throw new Error(
      `Embedding dimension mismatch: got ${input.embedding.length}, expected ${DIM} (AI_EMBEDDING_DIM). ` +
        "Align your embedding model with the vector column dimension.",
    );
  }
  const item = await prisma.memoryItem.create({
    data: {
      guildId: input.guildId,
      agentId: input.agentId,
      kind: input.kind,
      content: input.content,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
  await pool.query(
    `UPDATE "MemoryItem" SET embedding = $1::vector WHERE id = $2`,
    [input.embedding, item.id],
  );
  return { ...item, metadata: (item.metadata as Record<string, unknown> | null) ?? null };
}

/**
 * Similarity search over the pgvector index (cosine distance <=>).
 * `limit` results, optional kind + agent filter.
 */
export async function searchMemory(input: {
  guildId: string;
  embedding: number[];
  limit?: number;
  kind?: MemoryKind;
  agentId?: string;
}): Promise<MemoryRecord[]> {
  const limit = Math.min(input.limit ?? 5, 20);
  const conditions = [`"guildId" = $1`];
  const params: unknown[] = [input.guildId];
  if (input.kind) {
    params.push(input.kind);
    conditions.push(`"kind" = $${params.length}`);
  }
  if (input.agentId) {
    params.push(input.agentId);
    conditions.push(`"agentId" = $${params.length}`);
  }
  params.push(input.embedding, limit);

  const { rows } = await pool.query<{
    id: string;
    guildId: string;
    agentId: string | null;
    kind: MemoryKind;
    content: string;
    metadata: unknown;
    createdAt: Date;
    similarity: number;
  }>(
    `SELECT id, "guildId", "agentId", kind, content, metadata, "createdAt",
            1 - (embedding <=> $${params.length - 1}::vector) AS similarity
     FROM "MemoryItem"
     WHERE ${conditions.join(" AND ")}
     ORDER BY embedding <=> $${params.length - 1}::vector
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    metadata: (r.metadata as Record<string, unknown>) ?? null,
    similarity: Number(r.similarity.toFixed(4)),
  }));
}

export async function recentMemory(guildId: string, limit = 20): Promise<MemoryRecord[]> {
  const items = await prisma.memoryItem.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return items.map((i) => ({ ...i, metadata: (i.metadata as Record<string, unknown> | null) ?? null }));
}

export async function forgetMemory(id: string): Promise<void> {
  await prisma.memoryItem.delete({ where: { id } });
  await pool.query(`DELETE FROM "MemoryItem" WHERE id = $1`, [id]).catch(() => {
    logger.warn({ id }, "memory row already gone from vector table");
  });
}
