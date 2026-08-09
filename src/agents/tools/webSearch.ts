import { logger } from "../../utils/logger.js";
import type { AgentTool, ToolContext } from "./registry.js";

/**
 * Best-effort web search via the DuckDuckGo Instant Answer API.
 * No API key required; results are limited (abstracts + top topics).
 */
export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the web (DuckDuckGo Instant Answer). Returns a short abstract and related topics. Use for current information, definitions, or quick fact checks.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
  async execute(args, _ctx: ToolContext) {
    const query = String(args.query ?? "");
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    url.searchParams.set("t", "discorp");

    const resp = await fetch(url, { headers: { "User-Agent": "discorp/0.1" } });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "web search failed");
      return `(web search failed with status ${resp.status})`;
    }
    const data = (await resp.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    };

    const lines: string[] = [];
    if (data.AbstractText) {
      lines.push(`Abstract: ${data.AbstractText}`);
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
    }
    const topics = (data.RelatedTopics ?? [])
      .flatMap((t) => (t.Topics ? t.Topics.map((x) => x) : [t]))
      .filter((t) => t.Text)
      .slice(0, 5)
      .map((t) => `- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ""}`);
    if (topics.length) lines.push("Related topics:", ...topics);

    return lines.length ? lines.join("\n") : "(no results found)";
  },
};
