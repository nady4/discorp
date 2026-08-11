import { ExecutionKind } from "@prisma/client";
import type { AgentTool } from "./registry.js";

/**
 * Inter-agent delegation: lets one agent hand a subtask to another agent and
 * receive their result back. Loaded lazily via dynamic import to avoid
 * circular imports with the agent framework.
 */
export const delegationTool: AgentTool = {
  name: "delegate_task",
  description:
    "Delegate a piece of work to another agent and get their result back. Use this when the work fits another agent's expertise better than yours.",
  parameters: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "Target agent id, e.g. qa, developer, security" },
      instruction: { type: "string", description: "Clear, self-contained instruction for the other agent" },
    },
    required: ["agentId", "instruction"],
  },
  async execute(args, ctx) {
    const agentId = String(args.agentId ?? "").toLowerCase();
    const instruction = String(args.instruction ?? "");
    if (!agentId || !instruction) return "delegate_task requires both agentId and instruction.";
    const { executor } = await import("../index.js");
    const result = await executor.run({
      guildId: ctx.guildId,
      agentId,
      kind: ExecutionKind.COLLABORATION,
      taskId: ctx.taskId,
      taskBrief: [
        `You were asked by another agent to handle this directly: ${instruction}`,
        "Complete the work and reply with your result.",
      ].join("\n"),
      maxToolRounds: 4,
    });
    return `Result from ${agentId}:\n${result.content.slice(0, 4000)}`;
  },
};
