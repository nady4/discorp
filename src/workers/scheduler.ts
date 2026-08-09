import { GuildMode } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { reviewQueue, autonomousQueue } from "./queues.js";
import { modeLevel } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Scheduled (background) work, gated by organization intensity:
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

/** Reconcile repeatable jobs in BullMQ with the desired schedule. */
export async function syncSchedules(): Promise<void> {
  const guilds = await prisma.guild.findMany();
  const desired = new Map<string, DesiredJob>();
  for (const guild of guilds) {
    for (const job of desiredJobsFor(guild)) {
      desired.set(`${job.queue}:${job.name}`, job);
    }
  }

  const [reviewJobs, autonomousJobs] = await Promise.all([
    reviewQueue.getRepeatableJobs(),
    autonomousQueue.getRepeatableJobs(),
  ]);

  for (const [queue, jobs] of [
    ["review", reviewJobs],
    ["autonomous", autonomousJobs],
  ] as const) {
    for (const job of jobs) {
      const key = `${queue}:${job.name}`;
      if (!desired.has(key)) {
        await reviewQueue.removeRepeatableByKey(job.key).catch(() => {});
        await autonomousQueue.removeRepeatableByKey(job.key).catch(() => {});
        logger.info({ key }, "removed stale scheduled job");
      }
    }
  }

  for (const [key, job] of desired) {
    const queue = job.queue === "review" ? reviewQueue : autonomousQueue;
    const existing = [...reviewJobs, ...autonomousJobs].find(
      (j) => j.name === job.name && (j as unknown as { pattern?: string }).pattern === job.cron,
    );
    if (!existing) {
      await queue.add(job.name, job.data, { repeat: { pattern: job.cron }, jobId: key });
      logger.info({ key, cron: job.cron }, "scheduled new job");
    }
  }
}

let interval: NodeJS.Timeout | undefined;

/** Start the scheduler (called from the bot ready handler). */
export function startScheduler(): void {
  void syncSchedules();
  interval ??= setInterval(() => void syncSchedules(), 60 * 60 * 1000);
  interval.unref();
  logger.info("scheduler started");
}

/** Manual refresh — call after /config mode or sleep changes. */
export function refreshSchedules(): void {
  void syncSchedules();
}
