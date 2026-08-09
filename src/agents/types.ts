import { z } from "zod";

export const AGENT_TOOL_NAMES = [
  "memory", // memory_search + memory_store (long-term memory)
  "report", // report_save (publish a report)
  "filesystem", // sandboxed file read/write in the workspace
  "github", // GitHub repo access (requires GITHUB_TOKEN)
  "web_search", // web search (DuckDuckGo, best-effort, no key)
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const agentDefinitionSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-_]{1,32}$/, "agent id must be lowercase alphanumeric (max 32 chars)"),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  tools: z.array(z.enum(AGENT_TOOL_NAMES)).default([]),
  permissions: z.array(z.string()).default([]),
  persona: z.string().min(1),
  modeMin: z.number().int().min(1).max(3).default(1),
  isCore: z.boolean().default(false),
  custom: z.boolean().default(false),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export interface AgentRegistryEntry {
  definition: AgentDefinition;
  /** Absolute path of the agent.json this entry was loaded from. */
  sourcePath: string;
}
