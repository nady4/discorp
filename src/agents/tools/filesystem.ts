import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import type { AgentTool, ToolContext } from "./registry.js";

const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file

const root = path.resolve(env.WORKSPACE_DIR);

/**
 * Resolve a tool-supplied path against the sandbox root. Throws if the
 * resolved path escapes the workspace (path traversal protection).
 */
function resolveSafe(relPath: string): string {
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace sandbox: ${relPath}`);
  }
  return resolved;
}

function toSummary(stat: { name: string; type: string; size: number }): string {
  return `${stat.type === "dir" ? "dir " : "file"} ${stat.name} (${stat.size} B)`;
}

export const filesystemTools: AgentTool[] = [
  {
    name: "filesystem_list",
    description: "List files and directories inside the organization workspace. Path is relative to the workspace root.",
    parameters: {
      type: "object",
      properties: { path: strParam("Directory path relative to workspace root") },
      required: ["path"],
    },
    async execute(args, _ctx) {
      const dir = resolveSafe(String(args.path ?? "."));
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const lines = await Promise.all(
        entries.map(async (e) => {
          let size = 0;
          if (e.isFile()) {
            try {
              const stat = await fs.stat(path.join(dir, e.name));
              size = stat.size;
            } catch {
              /* ignore */
            }
          }
          return toSummary({ name: e.name, type: e.isDirectory() ? "dir" : "file", size });
        }),
      );
      return lines.length ? lines.join("\n") : "(empty directory)";
    },
  },
  {
    name: "filesystem_read",
    description: "Read a file from the organization workspace (UTF-8 text).",
    parameters: {
      type: "object",
      properties: { path: strParam("File path relative to workspace root") },
      required: ["path"],
    },
    async execute(args, _ctx) {
      const file = resolveSafe(String(args.path));
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) throw new Error(`File not found: ${args.path}`);
      if (stat.size > MAX_FILE_BYTES) throw new Error(`File too large (${stat.size} B, max ${MAX_FILE_BYTES} B)`);
      return await fs.readFile(file, "utf8");
    },
  },
  {
    name: "filesystem_write",
    description: "Write text content to a file in the organization workspace (creates parent directories).",
    parameters: {
      type: "object",
      properties: {
        path: strParam("File path relative to workspace root"),
        content: strParam("Full content to write (UTF-8)"),
      },
      required: ["path", "content"],
    },
    async execute(args, _ctx) {
      const file = resolveSafe(String(args.path));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, String(args.content ?? ""), "utf8");
      logger.debug({ file: args.path }, "workspace file written");
      return `Wrote ${file.length} bytes to ${args.path}`;
    },
  },
];

function strParam(description: string): { type: string; description: string } {
  return { type: "string", description };
}
