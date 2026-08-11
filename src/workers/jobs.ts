import { GuildMode } from "@prisma/client";
import { modeLevel } from "../config/index.js";

/**
 * Desired background jobs, gated by organization intensity:
 *  - LIGHTWEIGHT (1): no background jobs
 *  - STANDARD (2): daily review at 18:00 UTC
 *  - AUTONOMOUS (3): daily review + autonomous session every 6 hours
 * Sleep mode pauses all jobs for the guild.
 */
export interface DesiredJob {
  queue: "review" | "autonomous";
  name: string;
  cron: string;
  data: Record<string, unknown>;
}

export function desiredJobsFor(guild: { id: string; mode: GuildMode; sleepMode: boolean }): DesiredJob[] {
  if (guild.sleepMode) return [];
  const level = modeLevel(guild.mode);
  if (level === 1) return [];

  const jobs: DesiredJob[] = [];
  if (level >= 2) {
    jobs.push({
      queue: "review",
      name: `review:daily:${guild.id}`,
      cron: "0 18 * * *", // daily 18:00 UTC
      data: { guildId: guild.id, type: "daily", scheduled: true },
    });
  }
  if (level >= 3) {
    jobs.push({
      queue: "autonomous",
      name: `autonomous:${guild.id}`,
      cron: "0 */6 * * *", // every 6 hours
      data: { guildId: guild.id },
    });
  }
  return jobs;
}
