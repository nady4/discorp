import { redis } from "../database/redis.js";

const TTL_SECONDS = 60 * 60 * 24; // 24h retention
const MAX_ENTRIES = 50;

function key(guildId: string, agentId: string): string {
  return `discorp:stm:${guildId}:${agentId}`;
}

/**
 * Short-term memory: a capped, TTL'd rolling context window per
 * guild+agent, stored in Redis lists. Used to give agents conversational
 * continuity without touching the vector store.
 */
export const shortTermMemory = {
  async push(guildId: string, agentId: string, entry: string): Promise<void> {
    const k = key(guildId, agentId);
    const pipeline = redis.multi();
    pipeline.lpush(k, entry);
    pipeline.ltrim(k, 0, MAX_ENTRIES - 1);
    pipeline.expire(k, TTL_SECONDS);
    await pipeline.exec();
  },

  /** Most recent entries first (lrange 0..n). */
  async recent(guildId: string, agentId: string, limit = 10): Promise<string[]> {
    const k = key(guildId, agentId);
    const entries = await redis.lrange(k, 0, limit - 1);
    return entries.filter((e): e is string => Boolean(e));
  },

  async clear(guildId: string, agentId: string): Promise<void> {
    await redis.del(key(guildId, agentId));
  },
};
