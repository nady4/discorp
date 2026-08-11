import type { AgentDefinition } from "../types.js";

export interface ToolContext {
  guildId: string;
  agentId: string;
  taskId?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema of arguments. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/** JSON Schema helper for a string param. */
export function strParam(description: string): { type: string; description: string } {
  return { type: "string", description };
}

export const TOOL_PERMISSION: Record<string, string> = {
  memory_search: "memory",
  memory_store: "memory",
  report_save: "report",
  filesystem_list: "filesystem",
  filesystem_read: "filesystem",
  filesystem_write: "filesystem",
  github_repo_info: "github",
  github_list_files: "github",
  github_read_file: "github",
  web_search: "web_search",
  linear_issue_create: "linear",
  jira_issue_create: "jira",
  notion_page_create: "notion",
  email_send: "email",
  slack_message: "slack",
  delegate_task: "delegation",
};

/**
 * Tool registry: builds the tool set available to an agent based on the
 * `tools` array in its agent.json definition. Built-ins (memory, report)
 * are always available; external tools (filesystem, github, web_search)
 * only when declared by the agent.
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  availableNames(): string[] {
    return [...this.tools.keys()];
  }

  forAgent(agent: AgentDefinition): AgentTool[] {
    return agent.tools.flatMap((t) => {
      const tool = this.tools.get(t);
      return tool ? [tool] : [];
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export const toolRegistry = new ToolRegistry();
