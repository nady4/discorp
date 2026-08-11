import { MemoryKind } from "@prisma/client";
import { embedText, searchMemory, storeMemory } from "../../memory/index.js";
import { normalizeKind } from "../../utils/memoryKind.js";
import type { AgentTool, ToolContext } from "./registry.js";

const MAX_STORE_LENGTH = 4000;

export { normalizeKind } from "../../utils/memoryKind.js";

export const memoryTools: AgentTool[] = [
  {
    name: "memory_search",
    description:
      "Search the organization's long-term memory for knowledge relevant to a query. Use this before answering when the task references past decisions, goals, or prior work.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Semantic search query" } },
      required: ["query"],
    },
    async execute(args, ctx) {
      const query = String(args.query ?? "");
      const { embedding } = await embedText(query, ctx.guildId);
      const results = await searchMemory({
        guildId: ctx.guildId,
        embedding,
        limit: 5,
        agentId: ctx.agentId,
      });
      if (results.length === 0) return "(no relevant memory found)";
      return results
        .map(
          (r, i) =>
            `[${i + 1}] (${r.kind}${r.similarity !== undefined ? `, similarity ${r.similarity}` : ""}${r.agentId ? `, by ${r.agentId}` : ""}) ${r.content.slice(0, 600)}`,
        )
        .join("\n");
    },
  },
  {
    name: "memory_store",
    description:
      "Store a fact, decision, lesson, or preference into the organization's long-term memory so other agents (and future runs) can retrieve it.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact/decision/lesson to remember" },
        kind: {
          type: "string",
          enum: Object.values(MemoryKind),
          description: "Type of memory entry",
        },
      },
      required: ["content"],
    },
    async execute(args, ctx) {
      const content = String(args.content ?? "").slice(0, MAX_STORE_LENGTH);
      const kind = normalizeKind(args.kind);
      const { embedding } = await embedText(content, ctx.guildId);
      const item = await storeMemory({
        guildId: ctx.guildId,
        agentId: ctx.agentId,
        kind,
        content,
        embedding,
      });
      return `Stored memory entry ${item.id} (${kind}).`;
    },
  },
];
