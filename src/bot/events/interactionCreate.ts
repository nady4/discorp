import type { Client, ChatInputCommandInteraction, GuildMember } from "discord.js";
import { commands } from "../commands/index.js";
import { ensureGuild } from "../../database/guilds.js";
import { errorEmbed } from "../../utils/discord.js";
import { DiscorpError, userMessage } from "../../utils/errors.js";
import { isAdmin } from "../../utils/permissions.js";
import { commandRateLimit } from "../../utils/rateLimit.js";
import { logger } from "../../utils/logger.js";

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

  const member = interaction.member as GuildMember | null;
  if (command.adminOnly && !isAdmin(member, interaction.user.id)) {
    await interaction.reply({
      embeds: [
        errorEmbed("No permission", "Only the bot owner (ADMIN_USER_IDS) or users with Manage Server permission can use this command."),
      ],
      ephemeral: true,
    });
    return;
  }

  if (command.rateLimited && !commandRateLimit.try(`${interaction.guildId}:${interaction.user.id}`)) {
    await interaction.reply({
      embeds: [errorEmbed("Slow down", "You're using AI-costing commands too fast. Wait a minute and try again.")],
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply();
    await command.execute(interaction);
  } catch (err) {
    // Only show a curated message to users — never raw provider/DB internals.
    const message = userMessage(err);
    if (!(err instanceof DiscorpError)) {
      logger.error({ err, command: interaction.commandName }, "command failed");
    }
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed("Command error", message)] });
    } else if (!interaction.replied) {
      await interaction.reply({ embeds: [errorEmbed("Command error", message)], ephemeral: true });
    } else {
      await interaction.followUp({ embeds: [errorEmbed("Command error", message)], ephemeral: true });
    }
  }
}
