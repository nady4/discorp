import { ExecutionKind, GuildMode } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { env, estimateCostUsd } from "../config/index.js";
import { registry } from "./registry.js";
import { toolRegistry, type AgentTool, type ToolContext } from "./tools/index.js";
import { buildSystemPrompt } from "./personalities.js";
import { costGuard, recordExecution } from "../utils/costGuard.js";
import { shortTermMemory } from "../memory/index.js";
import { createChatProvider, type ProviderOverrides } from "../providers/index.js";
import { toolResultMessage, type ChatMessage, type ToolSchema } from "../providers/types.js";
import { DiscorpError, errorMessage } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface AgentRunInput {
  guildId: string;
  agentId: string;
  /** What the agent should do (user-style instruction). */
  taskBrief: string;
  kind: ExecutionKind;
  taskId?: string;
  providerOverrides?: ProviderOverrides;
  maxTokens?: number;
  maxToolRounds?: number;
  /** Extra context appended to the system prompt (reports, org state...). */
  extraContext?: string;
}

export interface AgentRunResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  executionId: string;
  toolRounds: number;
  truncated: boolean;
}

const MAX_TOOL_RESULT_CHARS = 8000;
const DEFAULT_MAX_ROUNDS = 6;

function toToolSchema(t: AgentTool): ToolSchema {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

async function buildOrgSummary(guildId: string): Promise<string> {
  const [goals, recentReports] = await Promise.all([
    prisma.goal.findMany({
      where: { guildId, status: { in: ["IN_PROGRESS", "REVIEWING", "ANALYZING"] } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    prisma.report.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);

  const lines: string[] = [];
  if (goals.length) {
    lines.push("Active goals:");
    for (const g of goals) lines.push(`- [${g.status}] ${g.title} (${g.id})`);
  }
  if (recentReports.length) {
    lines.push("Latest reports:");
    for (const r of recentReports) lines.push(`- ${r.title} (${r.createdAt.toISOString().slice(0, 10)})`);
  }
  return lines.join("\n");
}

/**
 * Executes a single agent run: system prompt from the agent's persona +
 * responsibilities, short-term memory context, tool loop with the
 * provider abstraction, cost guard before and usage recording after.
 */
export class AgentExecutor {
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const agent = registry.get(input.agentId);
    if (!agent) {
      throw new DiscorpError(`Unknown agent: ${input.agentId}`, `Unknown agent '${input.agentId}'. See /agents.`);
    }
    const guild = await prisma.guild.findUnique({ where: { id: input.guildId } });
    if (!guild) {
      throw new DiscorpError(`Guild ${input.guildId} not registered`, "This guild is not registered yet. Try again in a moment.");
    }

    const provider = createChatProvider(input.providerOverrides);

    // ── Safety guard (budget, limits, sleep) ────────────────────────────
    const maxTokens = input.maxTokens ?? (await costGuard.maxTokensFor(input.guildId));
    const estimatedCostUsd = estimateCostUsd(provider.model, maxTokens, maxTokens, env);
    await costGuard.assertCanExecute({
      guildId: input.guildId,
      agentId: input.agentId,
      estimatedCostUsd,
      kind: input.kind,
    });

    // ── Context assembly ────────────────────────────────────────────────
    const tools = toolRegistry.forAgent(agent);
    const stm = await shortTermMemory.recent(input.guildId, input.agentId, 6);
    const orgSummary = await buildOrgSummary(input.guildId);

    const stmBlock = stm.length
      ? `\n\nRecent activity (short-term memory):\n${stm.map((e) => `- ${e}`).join("\n")}`
      : "";

    const system =
      buildSystemPrompt({ agent, guildMode: guild.mode, orgSummary: orgSummary || undefined }) +
      stmBlock +
      (input.extraContext ? `\n\nAdditional context:\n${input.extraContext}` : "");

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: input.taskBrief },
    ];

    // ── Tool loop ───────────────────────────────────────────────────────
    const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_ROUNDS;
    let rounds = 0;
    let content = "";
    let totalInput = 0;
    let totalOutput = 0;
    let model = provider.model;

    try {
      while (rounds <= maxRounds) {
        const result = await provider.chat({
          messages,
          tools: tools.map(toToolSchema),
          maxTokens,
        });
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;
        model = result.model;

        if (result.toolCalls.length === 0) {
          content = result.content;
          break;
        }

        messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          messages.push(toolResultMessage(call, await this.executeTool(call.name, call.arguments, input)));
        }
        rounds++;
        if (rounds >= maxRounds) {
          messages.push({
            role: "system",
            content: "Tool budget exhausted. Provide your final answer now, without calling any more tools.",
          });
        }
      }
      if (content === "") {
        content = "(no final answer produced — the model stopped without a closing message)";
      }
    } catch (err) {
      logger.error({ err, agentId: input.agentId }, "agent run failed");
      await recordExecution({
        guildId: input.guildId,
        agentId: input.agentId,
        taskId: input.taskId,
        kind: input.kind,
        model,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        costCents: estimateCostUsd(model, totalInput, totalOutput, env) * 100,
        prompt: `${system}\n\n${input.taskBrief}`.slice(0, 4000),
        error: errorMessage(err),
      });
      throw new DiscorpError(
        `Agent '${input.agentId}' failed: ${errorMessage(err)}`,
        `⚠️ ${agent.name} ran into a problem: ${errorMessage(err)}`,
      );
    }

    // ── Record usage + cost, update short-term memory ───────────────────
    const costCents = Math.round(estimateCostUsd(model, totalInput, totalOutput, env) * 1000) / 10;
    const executionId = await recordExecution({
      guildId: input.guildId,
      agentId: input.agentId,
      taskId: input.taskId,
      kind: input.kind,
      model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      costCents,
      prompt: `${system}\n\n${input.taskBrief}`.slice(0, 4000),
      output: content.slice(0, 4000),
    });

    await shortTermMemory.push(input.guildId, input.agentId, `${agent.name}: ${content.slice(0, 600)}`);

    return {
      content,
      model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      costCents,
      executionId,
      toolRounds: rounds,
      truncated: rounds >= maxRounds,
    };
  }

  private async executeTool(name: string, argumentsJson: string, input: AgentRunInput): Promise<string> {
    const tool = toolRegistry.get(name);
    if (!tool) {
      const available = toolRegistry.availableNames().join(", ");
      return `Unknown tool '${name}'. Available tools: ${available}.`;
    }
    const ctx: ToolContext = {
      guildId: input.guildId,
      agentId: input.agentId,
      taskId: input.taskId,
    };
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argumentsJson || "{}");
    } catch {
      args = {};
    }
    try {
      const result = await tool.execute(args, ctx);
      return result.slice(0, MAX_TOOL_RESULT_CHARS);
    } catch (err) {
      logger.warn({ tool: name, err: errorMessage(err) }, "tool execution failed");
      return `Error executing ${name}: ${errorMessage(err)}`;
    }
  }
}

export const executor = new AgentExecutor();
