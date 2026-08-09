import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { reviewEngine } from "../../orchestration/index.js";
import { errorEmbed, infoEmbed, sendLong, successEmbed, truncate } from "../../utils/discord.js";
import { errorMessage } from "../../utils/errors.js";
import { ReviewType } from "@prisma/client";
import type { CommandModule } from "./types.js";

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("review")
    .setDescription("Ask the organization to run a review")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Review type")
        .setRequired(true)
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Project", value: "project" },
          { name: "Code", value: "code" },
          { name: "Strategy", value: "strategy" },
          { name: "Security", value: "security" },
          { name: "Performance", value: "performance" },
        ),
    )
    .addStringOption((o) => o.setName("task").setDescription("Review a specific task by id"))
    .addStringOption((o) => o.setName("title").setDescription("Custom review title")),
  async execute(interaction) {
    const typeRaw = interaction.options.getString("type", true);
    const taskId = interaction.options.getString("task");
    const title = interaction.options.getString("title");
    const guildId = interaction.guildId!;

    const type = ReviewType[typeRaw.toUpperCase() as keyof typeof ReviewType];
    if (!type) {
      await interaction.editReply({ embeds: [errorEmbed("Invalid review type", typeRaw)] });
      return;
    }

    await interaction.editReply({ embeds: [infoEmbed("🔍 Review started", `Running ${typeRaw} review… (this can take a minute) with the org's agents.`)] });

    try {
      const result = await reviewEngine.runReview({
        guildId,
        type,
        requesterId: interaction.user.id,
        taskId: taskId ?? undefined,
        title: title ?? undefined,
      });

      const summary = result.content
        .split("\n")
        .filter((l) => /^(#|\*\*|Summary|- |\d+\.)/.test(l))
        .join("\n");

      await interaction.editReply({
        embeds: [
          successEmbed(`✅ ${truncate(result.title, 90)}`, truncate(summary, 1800) || "Review complete."),
        ],
      });
      await interaction.followUp({
        embeds: [
          infoEmbed("📄 Full report", `Led by **${result.leadAgentId}**${result.participants.length ? ` with ${result.participants.join(", ")}` : ""}. Full report id \`${result.reportId}\`.`),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Review failed", errorMessage(err))] });
    }
  },
};

export default command;
