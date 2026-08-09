import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { infoEmbed } from "../../utils/discord.js";
import type { CommandModule } from "./types.js";

const fmtUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`);

export const command: CommandModule = {
  data: new SlashCommandBuilder().setName("balance").setDescription("Show running costs of the organization"),
  async execute(interaction) {
    const guildId = interaction.guildId!;
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    const monthKey = now.toISOString().slice(0, 7);

    const [guild, day, month, allTime, byAgent] = await Promise.all([
      prisma.guild.findUnique({ where: { id: guildId } }),
      prisma.usageSummary.findUnique({ where: { guildId_period_granularity: { guildId, period: dayKey, granularity: "DAY" } } }),
      prisma.usageSummary.findUnique({ where: { guildId_period_granularity: { guildId, period: monthKey, granularity: "MONTH" } } }),
      prisma.agentExecution.aggregate({
        where: { guildId },
        _sum: { costCents: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      prisma.agentExecution.groupBy({
        by: ["agentId"],
        where: { guildId },
        _sum: { costCents: true },
        orderBy: { _sum: { costCents: "desc" } },
        take: 6,
      }),
    ]);

    const budget = guild?.maxMonthlyBudgetCents ?? 0;
    const spent = month?.costCents ?? 0;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));

    const lines = [
      `**Today** — ${fmtUsd(day?.costCents ?? 0)} · ${day?.executions ?? 0} executions · ${fmtTokens(day?.tokensIn ?? 0)} in / ${fmtTokens(day?.tokensOut ?? 0)} out`,
      ``,
      `**This month** — ${fmtUsd(spent)} / ${fmtUsd(budget)} budget`,
      `\`${bar}\` ${pct}% used`,
      ``,
      `**All time** — ${fmtUsd(allTime._sum.costCents ?? 0)} · ${allTime._count} executions · ${fmtTokens(allTime._sum.inputTokens ?? 0)} in / ${fmtTokens(allTime._sum.outputTokens ?? 0)} out tokens`,
      ``,
      `**Top agents by cost**:`,
      ...(byAgent.length
        ? byAgent.map((a) => `- ${a.agentId}: ${fmtUsd(a._sum.costCents ?? 0)}`)
        : ["- no executions yet"]),
      ``,
      `*Prices are estimates from the model pricing table (src/config/models.ts).*`,
    ];

    await interaction.editReply({ embeds: [infoEmbed("💰 Organization balance", lines.join("\n"))] });
  },
};

export default command;
