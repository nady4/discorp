import { prisma } from "../../database/prisma.js";
import type { AgentTool, ToolContext } from "./registry.js";

export const reportTool: AgentTool = {
  name: "report_save",
  description:
    "Publish a report into the organization's report archive (visible via /status and /memory). Use this to deliver findings, analyses, or progress updates.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Report title" },
      content: { type: "string", description: "Report body (markdown)" },
    },
    required: ["title", "content"],
  },
  async execute(args, ctx: ToolContext) {
    const title = String(args.title ?? "").slice(0, 200);
    const content = String(args.content ?? "").slice(0, 8000);
    const report = await prisma.report.create({
      data: {
        guildId: ctx.guildId,
        title,
        content,
        authorAgentId: ctx.agentId,
      },
    });
    return `Report saved (id ${report.id}).`;
  },
};
