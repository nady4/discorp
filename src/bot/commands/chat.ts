import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { ExecutionKind } from "@prisma/client";
import { executor } from "../../agents/index.js";
import { errorEmbed, infoEmbed, sendLong } from "../../utils/discord.js";
import { userMessage } from "../../utils/errors.js";
import type { CommandModule } from "./types.js";

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Talk to an agent")
    .addStringOption((o) => o.setName("agent").setDescription("Agent id (e.g. ceo, dev, qa)").setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("What you want to say or ask").setRequired(true)),
  async execute(interaction) {
    const agentId = interaction.options.getString("agent", true).toLowerCase();
    const message = interaction.options.getString("message", true);
    const guildId = interaction.guildId!;

    await interaction.editReply({ embeds: [infoEmbed("💬 Chatting", `**${agentId}** is thinking…`)] });

    try {
      const result = await executor.run({
        guildId,
        agentId,
        kind: ExecutionKind.COMMAND,
        taskBrief: message,
      });
      const cost = Math.round(result.costCents * 100) / 100;
      const lines = [
        `**${agentId}**:`,
        "",
        result.content,
        "",
        `_${result.model} · ${cost}¢ · ${result.inputTokens} in / ${result.outputTokens} out tokens_`,
      ];
      await sendLong(interaction, lines.join("\n").slice(0, 6000));
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Chat failed", userMessage(err))] });
    }
  },
  rateLimited: true,
};

export default command;
