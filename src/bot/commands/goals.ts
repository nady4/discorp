import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { GoalStatus } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { orchestrator } from "../../orchestration/index.js";
import { workflow } from "../../orchestration/index.js";
import { errorEmbed, infoEmbed, sendLong, successEmbed } from "../../utils/discord.js";
import { userMessage } from "../../utils/errors.js";
import type { CommandModule } from "./types.js";

async function addGoal(interaction: ChatInputCommandInteraction) {
  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description");
  const guildId = interaction.guildId!;

  const { id } = await orchestrator.addGoal({
    guildId,
    userId: interaction.user.id,
    title,
    description: description ?? undefined,
  });

  await interaction.editReply({
    embeds: [successEmbed("🎯 Goal created", `**${title}**\n\`${id}\``)],
  });

  try {
    const analysis = await orchestrator.analyzeGoal(guildId, id);
    const tasks = analysis.plan.tasks;
    const lines = [
      `**Goal**: ${title}`,
      ``,
      `**CEO strategy**:`,
      analysis.strategy.slice(0, 1200),
      ``,
      `**Task breakdown (${tasks.length})**:`,
      ...tasks.map((t, i) => `${i + 1}. **${t.title}** → \`${t.agentId ?? "routed"}\` [${t.priority}]`),
    ];
    await interaction.followUp({ embeds: [infoEmbed("📋 Goal analysis complete", lines.join("\n").slice(0, 4000))] });
  } catch (err) {
    await interaction.followUp({
      embeds: [errorEmbed("Analysis failed", userMessage(err))],
    });
  }
}

async function listGoals(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const goals = await prisma.goal.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { _count: { select: { tasks: true } } },
  });
  if (goals.length === 0) {
    await interaction.editReply({ embeds: [infoEmbed("No goals yet", "Create one with /goals add.")] });
    return;
  }
  const lines = goals.map((g) => {
    return `- **[${g.status}]** ${g.title} \`${g.id}\` (${g._count.tasks} tasks) — created ${g.createdAt.toISOString().slice(0, 10)}`;
  });
  await sendLong(interaction, lines.join("\n").slice(0, 4000));
}

async function viewGoal(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getString("goal", true);
  const guildId = interaction.guildId!;
  const goal = await prisma.goal.findFirst({
    where: { id, guildId },
    include: { tasks: { orderBy: { priority: "desc" } } },
  });
  if (!goal) {
    await interaction.editReply({ embeds: [errorEmbed("Goal not found", `No goal \`${id}\` in this guild.`)] });
    return;
  }
  const plan = (goal.plan ?? {}) as { summary?: string };
  const lines = [
    `**Status**: ${goal.status}`,
    `**Description**: ${goal.description ?? "(none)"}`,
    ``,
    plan.summary ? `**Strategy**:\n${plan.summary.slice(0, 800)}\n` : "",
    `**Tasks (${goal.tasks.length})**:`,
    ...goal.tasks.map(
      (t) => `- [${t.status}] **${t.title}** → ${t.assignedAgentId ?? "unassigned"} [${t.priority}]`,
    ),
  ];
  await sendLong(interaction, lines.join("\n").slice(0, 4000));
}

async function completeGoal(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getString("goal", true);
  const guildId = interaction.guildId!;
  const goal = await prisma.goal.findFirst({ where: { id, guildId } });
  if (!goal) {
    await interaction.editReply({ embeds: [errorEmbed("Goal not found", `No goal \`${id}\` in this guild.`)] });
    return;
  }
  if (goal.status === GoalStatus.IN_PROGRESS) {
    await workflow.startReview(goal.id);
  }
  await workflow.complete(goal.id);
  await interaction.editReply({ embeds: [successEmbed("✅ Goal completed", `**${goal.title}**`)] });
}

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("goals")
    .setDescription("Manage organization goals")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a new organization goal")
        .addStringOption((o) => o.setName("title").setDescription("Goal title").setRequired(true))
        .addStringOption((o) => o.setName("description").setDescription("Details about the goal")),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List all goals"))
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("View a goal's plan and tasks")
        .addStringOption((o) => o.setName("goal").setDescription("Goal id").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("complete")
        .setDescription("Mark a goal as completed")
        .addStringOption((o) => o.setName("goal").setDescription("Goal id").setRequired(true)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "add") return await addGoal(interaction);
      if (sub === "list") return await listGoals(interaction);
      if (sub === "view") return await viewGoal(interaction);
      if (sub === "complete") return await completeGoal(interaction);
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Error", userMessage(err))] });
    }
  },
  rateLimited: true,
};

export default command;
