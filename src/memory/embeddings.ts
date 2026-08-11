import { createEmbedder } from "../providers/index.js";
import { recordEmbeddingUsage } from "../utils/costGuard.js";
import { logger } from "../utils/logger.js";

let embedder: ReturnType<typeof createEmbedder> | null = null;

export function getEmbedder() {
  if (!embedder) {
    embedder = createEmbedder();
  }
  return embedder;
}

/**
 * Embed text, metering tokens/cost into the guild's usage aggregates when a
 * guildId is provided (embedding calls are not agent executions, so they do
 * not count against the daily execution cap).
 */
export async function embedText(text: string, guildId?: string): Promise<{ embedding: number[]; tokens: number }> {
  const result = await getEmbedder().embed({ text });
  if (guildId) {
    await recordEmbeddingUsage(guildId, getEmbedder().model, result.inputTokens).catch((err) => {
      // Metering must never break the memory operation itself.
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "embedding metering failed");
    });
  }
  return { embedding: result.embedding, tokens: result.inputTokens };
}
