import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { orchestrator } from "../../orchestration/index.js";
import { errorEmbed, infoEmbed, successEmbed, truncate } from "../../utils/discord.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandModule } from "./types.js";

async function assignNew(interaction: ChatInputCommandInteraction) {
  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description", true);
  const agent = interaction.options.getString("agent");
  const guildId = interaction.guildId!;

  await interaction.editReply({
    embeds: [infoEmbed("🛠️ Task started", `**${title}** assigned to ${agent ?? "best agent"} — running…`)],
  });

  try {
    const result = await orchestrator.runAdHocTask({
      guildId,
      userId: interaction.user.id,
      title,
      description,
      agentId: agent ?? undefined,
    });
    await interaction.followUp({
      embeds: [
        successEmbed(
          `✅ Task done — by ${result.agentId} ($${(result.costCents / 100).toFixed(4)})`,
          truncate(result.content, 3800),
        ),
      ],
    });
  } catch (err) {
    await interaction.followUp({ embeds: [errorEmbed("Task failed", errorMessage(err))] });
  }
}

async function assignTask(interaction: ChatInputCommandInteraction) {
  const taskId = interaction.options.getString("task", true);
  const agent = interaction.options.getString("agent");
  const guildId = interaction.guildId!;

  const { agentId } = await orchestrator.assignTask(guildId, taskId, agent ?? undefined);
  await interaction.editReply({
    embeds: [infoEmbed("📌 Task assigned", `Task \`${taskId}\` → **${agentId}**. Execute with /assign task again or wait for the worker.`)],
  });
}

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("assign")
    .setDescription("Assign work to an agent")
    .addSubcommand((s) =>
      s
        .setName("new")
        .setDescription("Create and run a one-off task")
        .addStringOption((o) => o.setName("title").setDescription("Task title").setRequired(true))
        .addStringOption((o) => o.setName("description").setDescription("Task description").setRequired(true))
        .addStringOption((o) => o.setName("agent").setDescription("Agent id (default: best match)")),
    )
    .addSubcommand((s) =>
      s
        .setName("task")
        .setDescription("Assign an existing task to an agent")
        .addStringOption((o) => o.setName("task").setDescription("Task id").setRequired(true))
        .addStringOption((o) => o.setName("agent").setDescription("Agent id (default: best match)")),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "new") return await assignNew(interaction);
      if (sub === "task") return await assignTask(interaction);
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Error", errorMessage(err))] });
    }
  },
};

export default command;
