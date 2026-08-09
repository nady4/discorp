import { Guild, GuildMode, ExecutionKind, Prisma } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { env } from "../config/index.js";
import { CostGuardError, ExecutionLimitError } from "./errors.js";
import { logger } from "./logger.js";

export interface GuardCheck {
  guildId: string;
  agentId: string;
  estimatedCostUsd: number;
  kind: string;
}

/**
 * Safety and cost controls, enforced before every agent execution:
 *  - guild sleep mode
 *  - agent sleep window
 *  - monthly budget cap
 *  - max executions per day
 *  - max tokens per execution (enforced by caller via maxTokens)
 */
export class CostGuard {
  async assertCanExecute({ guildId, agentId, estimatedCostUsd }: GuardCheck): Promise<void> {
    const [guild, guildAgent, usageToday] = await Promise.all([
      prisma.guild.findUnique({ where: { id: guildId } }),
      prisma.guildAgent.findUnique({ where: { guildId_agentId: { guildId, agentId } } }),
      prisma.usageSummary.findUnique({
        where: {
          guildId_period_granularity: { guildId, period: this.todayKey(), granularity: "DAY" },
        },
      }),
    ]);

    if (!guild) throw new CostGuardError("This guild is not registered with DisCorp yet.");

    if (guild.sleepMode) {
      throw new CostGuardError("The organization is in sleep mode. Wake it with /config sleep off.");
    }

    if (guildAgent?.sleepUntil && guildAgent.sleepUntil.getTime() > Date.now()) {
      throw new CostGuardError(`Agent is sleeping until ${guildAgent.sleepUntil.toISOString()}. Wake it with /config.`);
    }

    if (!guildAgent?.enabled) {
      throw new CostGuardError("This agent is disabled for this guild.");
    }

    // Monthly budget: current spend + estimated cost of this call
    const monthly = await prisma.usageSummary.findUnique({
      where: {
        guildId_period_granularity: { guildId, period: this.monthKey(), granularity: "MONTH" },
      },
    });
    const spent = monthly?.costCents ?? 0;
    const budgetCents = guild.maxMonthlyBudgetCents;
    const estimatedCents = Math.ceil(estimatedCostUsd * 100);
    if (spent + estimatedCents > budgetCents) {
      throw new CostGuardError(
        `Monthly budget exceeded ($${(spent / 100).toFixed(2)} / $${(budgetCents / 100).toFixed(2)}). Raise it with /config budget.`,
      );
    }

    const executionsToday = usageToday?.executions ?? 0;
    if (executionsToday >= guild.maxExecutionsPerDay) {
      throw new CostGuardError(
        `Daily execution limit reached (${guild.maxExecutionsPerDay}/${guild.maxExecutionsPerDay}). It resets at midnight UTC.`,
      );
    }
  }

  /** Compute max tokens for this call based on guild budget headroom. */
  async maxTokensFor(guildId: string): Promise<number> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    return Math.min(env.MAX_TOKENS_PER_EXECUTION, guild?.mode === GuildMode.LIGHTWEIGHT ? 2048 : env.MAX_TOKENS_PER_EXECUTION);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }
}

/** Record usage into AgentExecution + UsageSummary aggregates. Returns the execution id. */
export async function recordExecution(input: {
  guildId: string;
  agentId: string;
  taskId?: string;
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  prompt?: string;
  output?: string;
  error?: string;
}): Promise<string> {
  let executionId = "";
  await prisma.$transaction(async (tx) => {
    const created = await tx.agentExecution.create({
      data: {
        guildId: input.guildId,
        agentId: input.agentId,
        taskId: input.taskId,
        kind: input.kind as ExecutionKind,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costCents: input.costCents,
        prompt: input.prompt?.slice(0, 4000),
        output: input.output?.slice(0, 4000),
        error: input.error?.slice(0, 1000),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    executionId = created.id;
    await upsertUsage(tx, input.guildId, "DAY", input.inputTokens, input.outputTokens, input.costCents);
    await upsertUsage(tx, input.guildId, "MONTH", input.inputTokens, input.outputTokens, input.costCents);
  });
  logger.debug(
    { guildId: input.guildId, agentId: input.agentId, model: input.model, costCents: input.costCents },
    "execution recorded",
  );
  return executionId;
}

async function upsertUsage(
  tx: Prisma.TransactionClient,
  guildId: string,
  granularity: "DAY" | "MONTH",
  tokensIn: number,
  tokensOut: number,
  costCents: number,
): Promise<void> {
  const period = granularity === "DAY" ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7);
  await tx.usageSummary.upsert({
    where: { guildId_period_granularity: { guildId, period, granularity } },
    create: {
      guildId,
      period,
      granularity,
      tokensIn,
      tokensOut,
      costCents,
      executions: 1,
    },
    update: {
      tokensIn: { increment: tokensIn },
      tokensOut: { increment: tokensOut },
      costCents: { increment: costCents },
      executions: { increment: 1 },
    },
  });
}

export const costGuard = new CostGuard();

export type { Guild };
