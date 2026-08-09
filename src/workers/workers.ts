import { Worker } from "bullmq";
import { REVIEW_QUEUE, AUTONOMOUS_QUEUE, reviewQueue, autonomousQueue } from "./queues.js";
import { redis } from "../database/redis.js";
import { prisma } from "../database/prisma.js";
import { modeLevel } from "../config/index.js";
import { reviewEngine } from "../orchestration/index.js";
import { orchestrator } from "../orchestration/index.js";
import { executor, registry } from "../agents/index.js";
import { ExecutionKind, GuildMode, ReviewType } from "@prisma/client";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/errors.js";

export interface ReviewJobData {
  guildId: string;
  type?: string;
  title?: string;
  scheduled?: boolean;
}

export interface AutonomousJobData {
  guildId: string;
}

/** Post a report to the guild's configured report channel (if any). */
export async function postToGuild(guildId: string, content: string, title: string): Promise<void> {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild?.configChannelId) return;
  const { client } = await import("../bot/client.js");
  const channel = await client.channels.fetch(guild.configChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    logger.warn({ guildId }, "config channel unavailable, skipping post");
    return;
  }
  const textChannel = channel as NonNullable<typeof channel>;
  const chunks = chunkText(content, 1800);
  await textChannel.send({ content: `# ${title}` });
  for (const chunk of chunks) await textChannel.send(chunk);
}

function chunkText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < 500) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest);
  return chunks;
}

export function startWorkers(): void {
  const reviewWorker = new Worker(
    REVIEW_QUEUE,
    async (job) => {
      const data = job.data as ReviewJobData;
      logger.info({ guildId: data.guildId, type: data.type }, "processing scheduled review");
      const type = (data.type ?? "daily").toUpperCase() as keyof typeof ReviewType;
      const result = await reviewEngine.runReview({
        guildId: data.guildId,
        type: ReviewType[type],
        scheduled: true,
        title: data.title,
      });
      await postToGuild(data.guildId, result.content, result.title);
    },
    { connection: redis, concurrency: 2 },
  );

  const autonomousWorker = new Worker(
    AUTONOMOUS_QUEUE,
    async (job) => {
      const { guildId } = job.data as AutonomousJobData;
      logger.info({ guildId }, "autonomous session started");
      const guild = await prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild || guild.sleepMode) {
        logger.info({ guildId }, "guild sleeping or missing — skipping autonomous session");
        return;
      }

      const level = modeLevel(guild.mode);
      const now = Date.now();
      const guildAgents = await prisma.guildAgent.findMany({ where: { guildId } });
      const state = new Map(guildAgents.map((ga) => [ga.agentId, ga]));
      const enabled = registry
        .all.filter((e) => e.definition.modeMin <= level)
        .map((e) => e.definition.id)
        .filter((id) => {
          const ga = state.get(id);
          return ga?.enabled !== false && !(ga?.sleepUntil && ga.sleepUntil.getTime() > now);
        });

      if (enabled.length === 0) {
        logger.info({ guildId }, "no agents available — skipping");
        return;
      }

      const summary: string[] = [];

      // 1) Execute up to 2 pending/assigned tasks
      const pending = await prisma.task.findMany({
        where: { guildId, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } },
        orderBy: { priority: "desc" },
        take: 2,
      });
      for (const task of pending) {
        try {
          if (!task.assignedAgentId) {
            await orchestrator.assignTask(guildId, task.id);
          }
          const result = await orchestrator.executeTask(guildId, task.id);
          summary.push(`✅ Task completed — **${task.title}** (${result.agentId})`);
        } catch (err) {
          summary.push(`❌ Task failed — **${task.title}** (${errorMessage(err)})`);
        }
      }

      // 2) Proactive agent session (one agent, unless a task was already run)
      if (pending.length === 0) {
        const agentId = enabled[0]!;
        try {
          const result = await executor.run({
            guildId,
            agentId,
            kind: ExecutionKind.AUTONOMOUS,
            taskBrief: [
              "You are on an autonomous work session. The organization is idle.",
              "Choose ONE useful thing to do right now, for example:",
              "- Write a progress report or status memo for the organization",
              "- Research something relevant to an active goal",
              "- Review recent work and store lessons in memory",
              "- Draft something valuable (documentation, template, plan)",
              "If you produce findings worth keeping, save them with the report_save tool.",
              "End with a 2-3 sentence summary of what you did.",
            ].join("\n"),
          });
          summary.push(`🤖 ${agentId}: ${result.content.slice(0, 400)}`);
        } catch (err) {
          summary.push(`⚠️ Autonomous session error (${agentId}): ${errorMessage(err)}`);
        }
      }

      if (summary.length) {
        await postToGuild(guildId, summary.join("\n\n"), "🔄 Autonomous session report");
      }
    },
    { connection: redis, concurrency: 1 },
  );

  reviewWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "review worker job failed");
  });
  autonomousWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "autonomous worker job failed");
  });

  logger.info("bullmq workers started");
}
