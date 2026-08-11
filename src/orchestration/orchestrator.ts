import { ExecutionKind, GoalStatus, Priority, TaskStatus, type Goal, type Guild } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { executor } from "../agents/index.js";
import { registry } from "../agents/index.js";
import { routeTask } from "./router.js";
import { workflow } from "./workflow.js";
import { extractJson } from "../utils/json.js";
import { DiscorpError, errorMessage } from "../utils/errors.js";
import { modeLevel } from "../config/index.js";
import { logger } from "../utils/logger.js";

export interface GoalPlanTask {
  title: string;
  description: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  agentId?: string;
}

export interface GoalPlan {
  summary: string;
  phases: string[];
  risks: string[];
  tasks: GoalPlanTask[];
}

export interface GoalAnalysis {
  goalId: string;
  plan: GoalPlan;
  createdTaskIds: string[];
  strategy: string;
}

/**
 * Goal intake and execution orchestration:
 * 1. addGoal          — PENDING
 * 2. analyzeGoal      — CEO strategy + PM task breakdown → Task rows (IN_PROGRESS)
 * 3. assignTask/executeTask — task execution
 */
export class Orchestrator {
  async addGoal(input: { guildId: string; userId: string; title: string; description?: string }): Promise<{ id: string }> {
    const goal = await prisma.goal.create({
      data: {
        guildId: input.guildId,
        ownerId: input.userId,
        title: input.title,
        description: input.description,
        status: GoalStatus.PENDING,
      },
    });
    return { id: goal.id };
  }

  /** Run the goal-analysis workflow (CEO strategy → PM task breakdown). */
  async analyzeGoal(guildId: string, goalId: string): Promise<GoalAnalysis> {
    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.guildId !== guildId) {
      throw new DiscorpError(`Goal not found: ${goalId}`, "Goal not found in this guild.");
    }
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) throw new DiscorpError(`Guild not registered: ${guildId}`);

    await workflow.startAnalysis(goalId).catch((e) => {
      throw new DiscorpError(`Cannot analyze goal: ${errorMessage(e)}`);
    });

    try {
      return await this.runAnalysis(guild, goal);
    } catch (err) {
      // Never leave a goal stuck in ANALYZING when the analysis pipeline fails.
      await prisma.goal.update({ where: { id: goalId }, data: { status: GoalStatus.FAILED } }).catch(() => {});
      throw err;
    }
  }

  private async runAnalysis(guild: Guild, goal: Goal): Promise<GoalAnalysis> {
    const guildId = guild.id;
    const goalId = goal.id;
    const level = modeLevel(guild.mode);
    const activeAgents = registry.activeAtLevel(level).map((a) => a.id);
    const goalText = `Goal: ${goal.title}\nDescription: ${goal.description ?? "(none)"}`;

    // Step 1 — CEO strategy
    const strategy = await executor.run({
      guildId,
      agentId: "ceo",
      kind: ExecutionKind.GOAL,
      taskBrief: [
        `A new organization goal requires analysis. ${goalText}`,
        "Produce a concise strategy: 1) summary of what success looks like, 2) key phases, 3) top risks.",
        "Keep it under 300 words. No tool calls.",
      ].join("\n"),
      maxToolRounds: 1,
    });

    // Step 2 — PM task breakdown (JSON)
    const roster = activeAgents.map((id) => `${id} (${registry.get(id)?.role ?? "agent"})`).join(", ");
    const breakdown = await executor.run({
      guildId,
      agentId: "pm",
      kind: ExecutionKind.GOAL,
      taskBrief: [
        goalText,
        `CEO analysis:\n${strategy.content}`,
        `Available agents: ${roster}`,
        "Break the goal into 3-8 concrete tasks. Respond with STRICT JSON only (no markdown), in this exact shape:",
        `{"tasks":[{"title":"...","description":"... (with acceptance criteria)","priority":"HIGH|MEDIUM|LOW","agentId":"<one of the available agent ids>"}]}`,
      ].join("\n"),
      maxToolRounds: 1,
    });

    const parsed = extractJson<{ tasks?: GoalPlanTask[] }>(breakdown.content);
    const tasks: GoalPlanTask[] = (parsed?.tasks ?? []).slice(0, 8).map((t) => ({
      title: String(t.title ?? "Untitled task").slice(0, 200),
      description: String(t.description ?? "").slice(0, 2000),
      priority: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(t.priority ?? "") ? t.priority! : Priority.MEDIUM,
      agentId: t.agentId,
    }));

    const createdTaskIds: string[] = [];
    for (const t of tasks) {
      const agentId = t.agentId && activeAgents.includes(t.agentId)
        ? t.agentId
        : routeTask({ title: t.title, description: t.description, activeAgentIds: activeAgents });
      const task = await prisma.task.create({
        data: {
          guildId,
          goalId,
          title: t.title,
          description: t.description,
          priority: t.priority ?? Priority.MEDIUM,
          assignedAgentId: agentId,
          status: TaskStatus.ASSIGNED,
        },
      });
      createdTaskIds.push(task.id);
    }

    const plan: GoalPlan = {
      summary: strategy.content.slice(0, 2000),
      phases: [], // filled from strategy output when parsed; kept minimal for v1
      risks: [],
      tasks,
    };

    await prisma.goal.update({
      where: { id: goalId },
      data: { plan: plan as unknown as object, status: GoalStatus.IN_PROGRESS },
    });

    logger.info({ goalId, taskCount: createdTaskIds.length }, "goal analyzed");
    return { goalId, plan, createdTaskIds, strategy: strategy.content };
  }

  /** Assign a task to an agent (explicit or routed). */
  async assignTask(guildId: string, taskId: string, agentId?: string): Promise<{ taskId: string; agentId: string }> {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.guildId !== guildId) throw new DiscorpError(`Task not found: ${taskId}`, "Task not found.");
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) throw new DiscorpError(`Guild not registered: ${guildId}`);

    const level = modeLevel(guild.mode);
    const active = registry.activeAtLevel(level).map((a) => a.id);

    let chosen = agentId;
    if (chosen && !active.includes(chosen)) {
      throw new DiscorpError(`Agent '${chosen}' is not active at this org level`, `Agent '${chosen}' is not active at this org level. See /agents.`);
    }
    if (!chosen) {
      chosen = routeTask({ title: task.title, description: task.description, activeAgentIds: active });
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { assignedAgentId: chosen, status: TaskStatus.ASSIGNED },
    });
    return { taskId, agentId: chosen };
  }

  /** Execute an assigned task with its agent. */
  async executeTask(guildId: string, taskId: string): Promise<{ taskId: string; content: string; agentId: string }> {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.guildId !== guildId) throw new DiscorpError(`Task not found: ${taskId}`, "Task not found.");
    if (!task.assignedAgentId) throw new DiscorpError(`Task has no assigned agent`, "Assign this task first with /assign.");

    await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.IN_PROGRESS } });

    try {
      const result = await executor.run({
        guildId,
        agentId: task.assignedAgentId,
        kind: task.goalId ? ExecutionKind.GOAL : ExecutionKind.COMMAND,
        taskId,
        taskBrief: [
          `Task: ${task.title}`,
          `Priority: ${task.priority}`,
          `Description:\n${task.description}`,
          "Complete this task. Use your tools as needed. End with a concise summary of what you did.",
        ].join("\n"),
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.DONE, result: result.content.slice(0, 8000) },
      });
      // Auto-complete goal when all its tasks are done
      if (task.goalId) {
        await this.maybeCompleteGoal(task.goalId);
      }
      return { taskId, content: result.content, agentId: task.assignedAgentId };
    } catch (err) {
      await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.FAILED } });
      throw err;
    }
  }

  /** Create + assign + execute a one-off task (/assign with free text). */
  async runAdHocTask(input: { guildId: string; userId: string; title: string; description: string; agentId?: string }): Promise<{
    taskId: string;
    content: string;
    agentId: string;
    costCents: number;
  }> {
    const task = await prisma.task.create({
      data: {
        guildId: input.guildId,
        title: input.title.slice(0, 200),
        description: input.description.slice(0, 2000),
        status: TaskStatus.PENDING,
      },
    });
    await this.assignTask(input.guildId, task.id, input.agentId);
    const result = await this.executeTask(input.guildId, task.id);
    const execution = await prisma.agentExecution.findFirst({
      where: { taskId: task.id, agentId: result.agentId },
      orderBy: { startedAt: "desc" },
    });
    return { taskId: task.id, content: result.content, agentId: result.agentId, costCents: execution?.costCents ?? 0 };
  }

  private async maybeCompleteGoal(goalId: string): Promise<void> {
    const [remaining, goal] = await Promise.all([
      prisma.task.count({ where: { goalId, status: { not: TaskStatus.DONE } } }),
      prisma.goal.findUnique({ where: { id: goalId } }),
    ]);
    if (remaining !== 0 || !goal) return;
    if (goal.status === GoalStatus.COMPLETED || goal.status === GoalStatus.FAILED) return;

    if (goal.status === GoalStatus.REVIEWING) {
      await workflow.complete(goalId).catch((e) => {
        logger.warn({ goalId, err: errorMessage(e) }, "goal auto-complete failed");
      });
      return;
    }
    if (goal.status === GoalStatus.IN_PROGRESS) {
      await workflow.startReview(goalId).catch((e) => {
        logger.warn({ goalId, err: errorMessage(e) }, "goal auto-review start failed");
      });
      await workflow.complete(goalId).catch((e) => {
        logger.warn({ goalId, err: errorMessage(e) }, "goal auto-complete failed");
      });
      return;
    }
    logger.warn({ goalId, status: goal.status }, "goal cannot auto-complete from its current state");
  }
}

export const orchestrator = new Orchestrator();
