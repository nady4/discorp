/**
 * Simple in-memory sliding-window rate limiter. Single-process only; the bot
 * runs one instance per deployment, which is sufficient.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  try(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

/** Per-user budget for AI-costing commands (5 per minute per guild). */
export const commandRateLimit = new RateLimiter(5, 60_000);
