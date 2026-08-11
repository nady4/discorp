import { prisma } from "../database/prisma.js";
import { reviewQueue, autonomousQueue } from "./queues.js";
import { desiredJobsFor, type DesiredJob } from "./jobs.js";
import { logger } from "../utils/logger.js";

export type { DesiredJob } from "./jobs.js";
export { desiredJobsFor } from "./jobs.js";

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
