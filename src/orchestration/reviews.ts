import { ExecutionKind, ReviewStatus, ReviewType } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { executor, registry } from "../agents/index.js";
import { modeLevel } from "../config/index.js";
import { DiscorpError, errorMessage } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface ReviewPlan {
  lead: string;
  participants: string[]; // agent ids, joined in order
}

const REVIEW_PLANS: Record<ReviewType, ReviewPlan> = {
  [ReviewType.DAILY]: { lead: "ceo", participants: ["pm"] },
  [ReviewType.PROJECT]: { lead: "pm", participants: ["ceo", "cto", "qa"] },
  [ReviewType.CODE]: { lead: "cto", participants: ["qa", "security"] },
  [ReviewType.STRATEGY]: { lead: "ceo", participants: ["pm", "finance"] },
  [ReviewType.SECURITY]: { lead: "security", participants: ["cto"] },
  [ReviewType.PERFORMANCE]: { lead: "finance", participants: ["cto"] },
};

export interface ReviewInput {
  guildId: string;
  type: ReviewType;
  requesterId?: string;
  taskId?: string;
  scheduled?: boolean;
  title?: string;
}

export interface ReviewOutput {
  reviewId: string;
  type: ReviewType;
  title: string;
  reportId: string;
  content: string;
  leadAgentId: string;
  participants: string[];
}

async function availableAgents(guildId: string): Promise<Set<string>> {
  const [guild, guildAgents] = await Promise.all([
    prisma.guild.findUnique({ where: { id: guildId } }),
    prisma.guildAgent.findMany({ where: { guildId } }),
  ]);
  const level = guild ? modeLevel(guild.mode) : 1;
  const active = new Set(registry.activeAtLevel(level).map((a) => a.id));
  const now = Date.now();
  for (const ga of guildAgents) {
    if (!ga.enabled || (ga.sleepUntil && ga.sleepUntil.getTime() > now)) {
      active.delete(ga.agentId);
    }
  }
  return active;
}

/** Resolve lead + participant list for a review type at this guild's level. */
async function resolvePlan(guildId: string, type: ReviewType): Promise<{ lead: string; participants: string[] }> {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  const level = guild ? modeLevel(guild.mode) : 1;
  const available = await availableAgents(guildId);

  const plan = REVIEW_PLANS[type];
  const participants = plan.participants.filter((id) => available.has(id));
  // Level 1: single-agent reviews (lowest cost)
  if (level === 1) {
    return { lead: available.has(plan.lead) ? plan.lead : plan.participants.find((p) => available.has(p)) ?? "ceo", participants: [] };
  }
  // Level 2: keep at most one participant
  if (level === 2) {
    return { lead: available.has(plan.lead) ? plan.lead : plan.participants[0] ?? "ceo", participants: participants.slice(0, 1) };
  }
  return { lead: available.has(plan.lead) ? plan.lead : plan.participants[0] ?? "ceo", participants };
}

/**
 * Review engine: multi-agent reviews for all six review types.
 * Lead agent produces findings; participants (gated by org level) do a
 * second-pass critique = agent-to-agent collaboration.
 */
export class ReviewEngine {
  async runReview(input: ReviewInput): Promise<ReviewOutput> {
    const guild = await prisma.guild.findUnique({ where: { id: input.guildId } });
    if (!guild) throw new DiscorpError(`Guild not registered: ${input.guildId}`);

    const { lead, participants } = await resolvePlan(input.guildId, input.type);

    const review = await prisma.review.create({
      data: {
        guildId: input.guildId,
        type: input.type,
        title: input.title ?? this.defaultTitle(input.type),
        status: ReviewStatus.IN_PROGRESS,
        requesterId: input.requesterId,
        leadAgentId: lead,
        participants,
        taskId: input.taskId,
        scheduled: input.scheduled ?? false,
      },
    });

    const context = await this.gatherContext(input.guildId, input.taskId);

    const leadRun = await executor.run({
      guildId: input.guildId,
      agentId: lead,
      kind: ExecutionKind.REVIEW,
      taskId: input.taskId,
      maxToolRounds: 3,
      taskBrief: [
        `You are leading a ${input.type.toLowerCase()} review of the organization.`,
        `Review title: ${review.title}`,
        `Context:\n${context}`,
        "Produce findings with these sections:",
        "- Summary",
        "- Strengths",
        "- Issues (each with severity: critical / major / minor)",
        "- Recommended actions",
        "Be specific and reference actual goals, tasks, or reports. Keep under 600 words.",
      ].join("\n"),
    });

    const participantOutputs: Record<string, string> = {};
    for (const participantId of participants) {
      const agent = registry.get(participantId);
      try {
        const run = await executor.run({
          guildId: input.guildId,
          agentId: participantId,
          kind: ExecutionKind.COLLABORATION,
          taskId: input.taskId,
          maxToolRounds: 2,
          taskBrief: [
            `The lead ${input.type.toLowerCase()} review produced these findings:`,
            leadRun.content,
            `From your perspective as ${agent?.role ?? "agent"}, add your assessment: confirm, correct, or add new issues. Keep under 250 words.`,
          ].join("\n"),
        });
        participantOutputs[participantId] = run.content;
      } catch (err) {
        logger.warn({ participantId, err: errorMessage(err) }, "participant review failed");
        participantOutputs[participantId] = `(review failed: ${errorMessage(err)})`;
      }
    }

    const findings = {
      lead: { agentId: lead, content: leadRun.content },
      participants: participantOutputs,
      context: {
        activeGoals: context.match(/Active goals: (\d+)/)?.[1] ?? 0,
      },
    };

    const content = [
      `## ${review.title}`,
      "",
      `**Led by**: ${lead}${participants.length ? ` · **Participants**: ${participants.join(", ")}` : ""}`,
      "",
      leadRun.content,
      ...Object.entries(participantOutputs).flatMap(([id, text]) => [
        "",
        `---`,
        `**${id}**`,
        "",
        text,
      ]),
    ].join("\n");

    const report = await prisma.report.create({
      data: {
        guildId: input.guildId,
        reviewId: review.id,
        title: review.title,
        content,
        authorAgentId: lead,
      },
    });

    await prisma.review.update({
      where: { id: review.id },
      data: { status: ReviewStatus.COMPLETED, findings: findings as unknown as object, reportId: report.id },
    });

    logger.info({ reviewId: review.id, type: input.type, lead, participants }, "review completed");
    return {
      reviewId: review.id,
      type: input.type,
      title: review.title,
      reportId: report.id,
      content,
      leadAgentId: lead,
      participants,
    };
  }

  private defaultTitle(type: ReviewType): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${type.charAt(0) + type.slice(1).toLowerCase()} review — ${date}`;
  }

  private async gatherContext(guildId: string, taskId?: string): Promise<string> {
    const lines: string[] = [];
    if (taskId) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, include: { goal: true } });
      if (task) {
        lines.push(`Task under review: ${task.title} (${task.status})`);
        lines.push(`Task description: ${task.description}`);
        if (task.result) lines.push(`Task result:\n${task.result.slice(0, 1500)}`);
        if (task.goal) lines.push(`Parent goal: ${task.goal.title} (${task.goal.status})`);
      }
    }

    const [goals, tasks, reports, todayUsage] = await Promise.all([
      prisma.goal.findMany({
        where: { guildId, status: { notIn: ["FAILED"] } },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.task.findMany({
        where: { guildId, status: { in: ["ASSIGNED", "IN_PROGRESS", "IN_REVIEW"] } },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.report.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId, period: new Date().toISOString().slice(0, 10), granularity: "DAY" } },
      }),
    ]);

    if (goals.length) lines.push(`Active goals: ${goals.length}`);
    lines.push(`Tasks in progress: ${tasks.length}`);
    lines.push(`Reports available: ${reports.length}`);
    lines.push(`Executions today: ${todayUsage?.executions ?? 0} (cost $${((todayUsage?.costCents ?? 0) / 100).toFixed(2)})`);
    if (tasks.length) {
      lines.push("Open tasks:");
      for (const t of tasks) lines.push(`- [${t.priority}] ${t.title} → ${t.assignedAgentId ?? "unassigned"} (${t.status})`);
    }
    if (reports.length) {
      lines.push("Recent reports:");
      for (const r of reports) lines.push(`- ${r.title}`);
    }
    return lines.join("\n");
  }
}

export const reviewEngine = new ReviewEngine();
