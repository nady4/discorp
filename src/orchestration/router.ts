/**
 * Task routing: picks the best agent for a task based on keyword scoring
 * against agent roles/responsibilities. Falls back to PM, then any active
 * agent. Explicit agentId on a task always wins.
 */
import { registry } from "../agents/index.js";

const KEYWORDS: Record<string, string[]> = {
  cto: ["architecture", "technical", "stack", "infrastructure", "scalability", "design decision", "code review", "standard", "tech debt"],
  developer: ["implement", "build", "code", "write", "fix", "bug", "feature", "refactor", "develop", "component", "function", "module", "api"],
  qa: ["test", "verify", "quality", "qa", "regression", "acceptance", "coverage", "validate"],
  research: ["research", "analyze", "market", "compare", "evaluate", "investigate", "benchmark", "trend", "options", "report on", "study"],
  security: ["security", "vulnerability", "audit", "compliance", "secret", "permission", "threat", "patching"],
  marketing: ["marketing", "launch", "positioning", "messaging", "campaign", "audience", "copy", "content"],
  finance: ["cost", "budget", "pricing", "forecast", "finance", "spend", "revenue", "unit economics"],
  community: ["announcement", "community", "announce", "summary", "changelog", "update for users"],
  pm: ["requirement", "roadmap", "plan", "ticket", "backlog", "user story", "acceptance criteria", "milestone"],
  ceo: ["strategy", "priority", "decision", "direction", "vision", "portfolio"],
};

function score(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((acc, kw) => (lower.includes(kw) ? acc + 1 : acc), 0);
}

/** Route a task to the best available agent id. */
export function routeTask(input: { title: string; description: string; activeAgentIds: string[] }): string {
  const { title, description, activeAgentIds } = input;
  const text = `${title} ${description}`;

  const scored = activeAgentIds
    .map((id) => ({ id, score: score(text, KEYWORDS[id] ?? []) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score > 0) return best.id;

  return activeAgentIds.includes("pm") ? "pm" : (activeAgentIds[0] ?? "ceo");
}
