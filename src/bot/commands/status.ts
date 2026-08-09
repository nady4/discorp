import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { modeLevel } from "../../config/index.js";
import { infoEmbed } from "../../utils/discord.js";
import type { CommandModule } from "./types.js";

export const command: CommandModule = {
  data: new SlashCommandBuilder().setName("status").setDescription("Show organization state"),
  async execute(interaction) {
    const guildId = interaction.guildId!;
    const [guild, goals, tasks, today, month, agents, reports, reviews] = await Promise.all([
      prisma.guild.findUnique({ where: { id: guildId } }),
      prisma.goal.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.task.findMany({ where: { guildId }, orderBy: { updatedAt: "desc" }, take: 10 }),
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId, period: new Date().toISOString().slice(0, 10), granularity: "DAY" } },
      }),
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId, period: new Date().toISOString().slice(0, 7), granularity: "MONTH" } },
      }),
      prisma.guildAgent.findMany({ where: { guildId } }),
      prisma.report.count({ where: { guildId } }),
      prisma.review.count({ where: { guildId } }),
    ]);

    if (!guild) {
      await interaction.editReply({ embeds: [infoEmbed("Not registered", "This guild is not set up yet.")] });
      return;
    }

    const now = Date.now();
    const sleeping = agents.filter((a) => a.sleepUntil && a.sleepUntil.getTime() > now).map((a) => a.agentId);
    const disabled = agents.filter((a) => !a.enabled).map((a) => a.agentId);

    const budget = guild.maxMonthlyBudgetCents / 100;
    const spent = (month?.costCents ?? 0) / 100;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

    const modeNames = { LIGHTWEIGHT: "Level 1 · Lightweight", STANDARD: "Level 2 · Standard", AUTONOMOUS: "Level 3 · Autonomous" };

    const lines = [
      `**Mode**: ${modeNames[guild.mode]} (level ${modeLevel(guild.mode)})${guild.sleepMode ? " · 😴 ORG ASLEEP" : ""}`,
      ``,
      `**Goals**: ${goals.map((g) => `${g.title} [${g.status}]`).join(", ") || "none yet"}`,
      ``,
      `**Recent tasks**:`,
      ...(tasks.length
        ? tasks.map((t) => `- [${t.status}] ${t.title} → ${t.assignedAgentId ?? "unassigned"}`)
        : ["- none yet"]),
      ``,
      `**Agents**: ${agents.length} configured${disabled.length ? ` · disabled: ${disabled.join(", ")}` : ""}${sleeping.length ? ` · 😴 sleeping: ${sleeping.join(", ")}` : ""}`,
      `**Reports**: ${reports} · **Reviews**: ${reviews}`,
      ``,
      `**Today**: ${today?.executions ?? 0} executions · $${((today?.costCents ?? 0) / 100).toFixed(2)} (${today?.tokensIn ?? 0} in / ${today?.tokensOut ?? 0} out tokens)`,
      `**This month**: $${spent.toFixed(2)} / $${budget.toFixed(2)} budget (${pct}%)`,
      `**Execution cap**: ${today?.executions ?? 0}/${guild.maxExecutionsPerDay} today`,
    ];

    await interaction.editReply({ embeds: [infoEmbed("🏢 Organization status", lines.join("\n"))] });
  },
};

export default command;
