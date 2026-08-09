import type { AgentDefinition } from "./types.js";
import { modeLevel, type OrgMode } from "../config/modes.js";
import { ORG_MODE_LEVELS } from "../config/index.js";

const MODE_LABELS: Record<OrgMode, string> = {
  LIGHTWEIGHT: "Level 1 · Lightweight (low cost, reactive)",
  STANDARD: "Level 2 · Standard (collaborating company assistant)",
  AUTONOMOUS: "Level 3 · Autonomous (full AI organization)",
};

/** Build the system prompt for an agent run. */
export function buildSystemPrompt(input: {
  agent: AgentDefinition;
  guildMode: OrgMode;
  orgSummary?: string;
}): string {
  const { agent, guildMode } = input;
  const level = modeLevel(guildMode);

  const sections: string[] = [
    agent.persona,
    "",
    `You are the ${agent.name} (${agent.role}) of DisCorp, a virtual AI organization operating in ${MODE_LABELS[guildMode]}.`,
  ];

  if (agent.responsibilities.length > 0) {
    sections.push(`Responsibilities:\n${agent.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }

  if (agent.permissions.length > 0) {
    sections.push(`Your capabilities (permissions): ${agent.permissions.join(", ")}`);
  }

  sections.push(
    `Organization intensity: Level ${level} (${guildMode}).` +
      (level === 1
        ? " Keep responses short and cheap: one focused pass, minimal tool use."
        : level === 2
          ? " You may collaborate with other agents and use tools as needed."
          : " You are expected to work proactively, use your tools, and drive tasks to completion."),
  );

  if (input.orgSummary) {
    sections.push(`Organization context:\n${input.orgSummary}`);
  }

  sections.push(
    `Current date: ${new Date().toISOString()}`,
    "Guidelines:",
    "- Be concrete and actionable. Prefer lists over prose.",
    "- If you use a tool, follow up with a summary of what you did.",
    "- If information is missing, say so instead of inventing it.",
    "- Keep the final answer under 500 words unless the task demands more.",
  );

  return sections.join("\n");
}

/** Short label used in logs/DB for an execution. */
export function executionKindFor(run: "goal" | "review" | "command" | "autonomous" | "collaboration"): string {
  return run.toUpperCase();
}
