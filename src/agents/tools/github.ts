import { env } from "../../config/index.js";
import type { AgentTool, ToolContext } from "./registry.js";

const GH_API = "https://api.github.com";
const MAX_FILE_BYTES = 512 * 1024;

async function gh(path: string, params: Record<string, string> = {}): Promise<unknown> {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GitHub tool is not configured: GITHUB_TOKEN is not set. Ask the organization owner to add it to the environment.");
  }
  const url = new URL(`${GH_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "discorp",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

function parseRepo(repo: string): { owner: string; repoName: string } {
  const cleaned = repo.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  const [owner, repoName] = cleaned.split("/");
  if (!owner || !repoName) throw new Error(`Invalid repository: ${repo}. Use owner/name format.`);
  return { owner, repoName };
}

export const githubTools: AgentTool[] = [
  {
    name: "github_repo_info",
    description: "Get metadata about a GitHub repository (description, language, stars, default branch).",
    parameters: {
      type: "object",
      properties: { repo: { type: "string", description: "Repository in owner/name format" } },
      required: ["repo"],
    },
    async execute(args, _ctx) {
      const { owner, repoName } = parseRepo(String(args.repo));
      const data = (await gh(`/repos/${owner}/${repoName}`)) as Record<string, unknown>;
      return [
        `Repository: ${owner}/${repoName}`,
        `Description: ${data.description ?? "(none)"}`,
        `Language: ${data.language ?? "unknown"}`,
        `Stars: ${data.stargazers_count ?? 0}`,
        `Default branch: ${data.default_branch ?? "main"}`,
        `Updated: ${data.updated_at ?? "unknown"}`,
      ].join("\n");
    },
  },
  {
    name: "github_list_files",
    description: "List files in a directory of a GitHub repository.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name format" },
        path: { type: "string", description: "Directory path (default: repo root)" },
        branch: { type: "string", description: "Branch or ref (default: default branch)" },
      },
      required: ["repo"],
    },
    async execute(args, _ctx) {
      const { owner, repoName } = parseRepo(String(args.repo));
      const dirPath = String(args.path ?? "");
      const branch = String(args.branch ?? "");
      const data = (await gh(`/repos/${owner}/${repoName}/contents/${dirPath}`, branch ? { ref: branch } : {})) as Array<Record<string, unknown>>;
      if (!Array.isArray(data)) return "(not a directory)";
      return data
        .map((f) => `${f.type === "dir" ? "dir " : "file"} ${f.name}`)
        .join("\n");
    },
  },
  {
    name: "github_read_file",
    description: "Read a file from a GitHub repository (text, base64-decoded).",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name format" },
        path: { type: "string", description: "File path" },
        branch: { type: "string", description: "Branch or ref (default: default branch)" },
      },
      required: ["repo", "path"],
    },
    async execute(args, _ctx) {
      const { owner, repoName } = parseRepo(String(args.repo));
      const filePath = String(args.path);
      const branch = String(args.branch ?? "");
      const data = (await gh(`/repos/${owner}/${repoName}/contents/${filePath}`, branch ? { ref: branch } : {})) as Record<string, unknown>;
      if (typeof data.size === "number" && data.size > MAX_FILE_BYTES) {
        throw new Error(`File too large (${data.size} B, max ${MAX_FILE_BYTES} B)`);
      }
      const content = Buffer.from(String(data.content ?? ""), "base64").toString("utf8");
      return content.slice(0, 40_000);
    },
  },
];
