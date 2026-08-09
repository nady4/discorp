import type { Client, ChatInputCommandInteraction } from "discord.js";
import { commands } from "../commands/index.js";
import { ensureGuild } from "../../database/guilds.js";
import { errorEmbed } from "../../utils/discord.js";
import { errorMessage } from "../../utils/errors.js";

export async function onInteractionCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) {
    await interaction.reply({
      embeds: [errorEmbed("Guild only", "DisCorp organizations live in Discord servers — run this command in a server with the bot.")],
      ephemeral: true,
    });
    return;
  }

  try {
    await ensureGuild(interaction.guildId);
  } catch {
    /* not fatal — command handlers surface registration issues */
  }

  const command = commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ embeds: [errorEmbed("Unknown command", interaction.commandName)], ephemeral: true });
    return;
  }

  try {
    await interaction.deferReply();
    await command.execute(interaction);
  } catch (err) {
    const message = errorMessage(err);
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed("Command error", message)] });
    } else if (!interaction.replied) {
      await interaction.reply({ embeds: [errorEmbed("Command error", message)], ephemeral: true });
    } else {
      await interaction.followUp({ embeds: [errorEmbed("Command error", message)], ephemeral: true });
    }
  }
}
