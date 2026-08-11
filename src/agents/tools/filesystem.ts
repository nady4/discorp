import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import type { AgentTool, ToolContext } from "./registry.js";

const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file

const root = path.resolve(env.WORKSPACE_DIR);

/**
 * Resolve a tool-supplied path against the sandbox root and verify the real
 * (symlink-followed) location stays inside the workspace. Walk up to the
 * nearest existing ancestor so realpath can resolve paths that don't exist
 * yet (write path).
 */
async function resolveSafe(relPath: string): Promise<string> {
  return resolveSafePath(relPath, root);
}

/**
 * Resolve a path against a sandbox root and verify the real (symlink-followed)
 * location stays inside it. Walk up to the nearest existing ancestor so
 * realpath can resolve paths that don't exist yet (write path). Exported for
 * tests.
 */
export async function resolveSafePath(relPath: string, sandboxRoot: string): Promise<string> {
  const rootDir = path.resolve(sandboxRoot);
  await fs.mkdir(rootDir, { recursive: true });
  const resolved = path.resolve(rootDir, relPath);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    throw new Error(`Path escapes the workspace sandbox: ${relPath}`);
  }

  let probe = resolved;
  const suffix: string[] = [];
  for (let i = 0; i < 64; i++) {
    const real = await fs.realpath(probe).catch(() => null);
    if (real) {
      if (real !== rootDir && !real.startsWith(rootDir + path.sep)) {
        throw new Error(`Path resolves outside the workspace sandbox: ${relPath}`);
      }
      return path.join(real, ...suffix);
    }
    suffix.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  throw new Error(`Path resolves outside the workspace sandbox: ${relPath}`);
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
      const dir = await resolveSafe(String(args.path ?? "."));
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
      const file = await resolveSafe(String(args.path));
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
      const content = String(args.content ?? "");
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_FILE_BYTES) throw new Error(`File too large (${bytes} B, max ${MAX_FILE_BYTES} B)`);
      const file = await resolveSafe(String(args.path));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, "utf8");
      logger.debug({ file: args.path }, "workspace file written");
      return `Wrote ${bytes} bytes to ${args.path}`;
    },
  },
];

function strParam(description: string): { type: string; description: string } {
  return { type: "string", description };
}
