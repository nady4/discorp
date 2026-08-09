import { filesystemTools } from "./filesystem.js";
import { memoryTools } from "./memory.js";
import { reportTool } from "./report.js";
import { githubTools } from "./github.js";
import { webSearchTool } from "./webSearch.js";
import { toolRegistry } from "./registry.js";

export * from "./registry.js";

/** Register all built-in tools. Call once at boot. */
export function registerTools(): void {
  for (const tool of [...memoryTools, reportTool, ...filesystemTools, ...githubTools, webSearchTool]) {
    toolRegistry.register(tool);
  }
}
