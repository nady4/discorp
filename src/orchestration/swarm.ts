import { ExecutionKind } from "@prisma/client";
import { executor } from "../agents/index.js";
import { DiscorpError, errorMessage } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface SwarmRun {
  agentId: string;
  content: string;
  failed: boolean;
}

export interface SwarmInput {
  guildId: string;
  prompt: string;
  agentIds: string[];
  taskId?: string;
  maxToolRounds?: number;
  /** When true, the CEO merges all perspectives into one synthesis. */
  merge?: boolean;
  title?: string;
}

export interface SwarmResult {
  runs: SwarmRun[];
  merged?: string;
}

/** Validate swarm agent count before spending any tokens. */
export function validateSwarmInput(agentIds: string[]): void {
  if (agentIds.length === 0) throw new DiscorpError("swarmRun requires at least one agent");
  if (agentIds.length > 8) throw new DiscorpError("swarmRun supports at most 8 agents per session");
  for (const id of agentIds) {
    if (!/^[a-z0-9-_]{1,32}$/.test(id)) throw new DiscorpError(`Invalid agent id: ${id}`);
  }
}

/**
 * Swarm session (v0.4): several agents tackle the same prompt in parallel,
 * each from their own specialty. Optionally merges the perspectives with a
 * CEO synthesis run and persists the result as a report.
 */
export async function swarmRun(input: SwarmInput): Promise<SwarmResult> {
  validateSwarmInput(input.agentIds);

  const runs = await Promise.all(
    input.agentIds.map(async (agentId) => {
      try {
        const result = await executor.run({
          guildId: input.guildId,
          agentId,
          kind: ExecutionKind.COLLABORATION,
          taskId: input.taskId,
          maxToolRounds: input.maxToolRounds ?? 3,
          taskBrief: [
            input.prompt,
            "Contribute your perspective from your role. Be concrete; keep it under 300 words.",
          ].join("\n"),
        });
        return { agentId, content: result.content, failed: false };
      } catch (err) {
        logger.warn({ agentId, err: errorMessage(err) }, "swarm participant failed");
        return { agentId, content: `(session failed: ${errorMessage(err)})`, failed: true };
      }
    }),
  );

  const result: SwarmResult = { runs };

  if (input.merge) {
    const merged = await executor.run({
      guildId: input.guildId,
      agentId: "ceo",
      kind: ExecutionKind.COLLABORATION,
      taskId: input.taskId,
      maxToolRounds: 2,
      taskBrief: [
        `A swarm session produced these perspectives on:\n${input.prompt}`,
        "",
        ...runs.map((r) => `--- ${r.agentId} ---\n${r.content}`),
        "",
        "Synthesize these into one concise decision memo with: 1) agreed points, 2) disagreements, 3) recommended action. Under 400 words.",
      ].join("\n"),
    });
    result.merged = merged.content;
  }

  return result;
}

/** Persist a swarm session as a Report row so /memory report can fetch it. */
export async function saveSwarmReport(guildId: string, input: SwarmInput, result: SwarmResult): Promise<string> {
  const { prisma } = await import("../database/prisma.js");
  const content = [
    `## Swarm session — ${input.title ?? "untitled"}`,
    "",
    `**Prompt**: ${input.prompt}`,
    "",
    ...result.runs.flatMap((r) => [`--- ${r.agentId} ---`, "", r.content, ""]),
    result.merged ? [`--- Synthesis (CEO) ---`, "", result.merged] : [],
  ].join("\n");
  const report = await prisma.report.create({
    data: { guildId, title: `Swarm — ${input.title ?? new Date().toISOString().slice(0, 10)}`, content, authorAgentId: "ceo" },
  });
  return report.id;
}
