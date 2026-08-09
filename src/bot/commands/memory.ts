import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { embedText, forgetMemory, recentMemory, searchMemory } from "../../memory/index.js";
import { errorEmbed, infoEmbed, successEmbed } from "../../utils/discord.js";
import { errorMessage } from "../../utils/errors.js";
import type { CommandModule } from "./types.js";

async function search(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  const guildId = interaction.guildId!;
  const { embedding } = await embedText(query);
  const results = await searchMemory({ guildId, embedding, limit: 8 });

  if (results.length === 0) {
    await interaction.editReply({ embeds: [infoEmbed("Memory search", `No results for *${query}*.`)] });
    return;
  }
  const lines = results.map(
    (r) => `- **[${r.kind}]** ${r.content.slice(0, 300)}${r.agentId ? ` *(by ${r.agentId})*` : ""} \`${r.id}\``,
  );
  await interaction.editReply({ embeds: [infoEmbed(`🔎 Memory search: ${query}`, lines.join("\n"))] });
}

async function recent(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const items = await recentMemory(guildId, 15);
  if (items.length === 0) {
    await interaction.editReply({ embeds: [infoEmbed("Memory", "No memory entries yet. Agents store knowledge as they work.")] });
    return;
  }
  const lines = items.map(
    (r) => `- **[${r.kind}]** ${r.content.slice(0, 250)}${r.agentId ? ` *(by ${r.agentId})*` : ""} — ${r.createdAt.toISOString().slice(0, 10)}`,
  );
  await interaction.editReply({ embeds: [infoEmbed("🧠 Recent memory", lines.join("\n"))] });
}

async function remove(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getString("id", true);
  const guildId = interaction.guildId!;
  const item = await prisma.memoryItem.findFirst({ where: { id, guildId } });
  if (!item) {
    await interaction.editReply({ embeds: [errorEmbed("Not found", `No memory entry \`${id}\` in this guild.`)] });
    return;
  }
  await forgetMemory(id);
  await interaction.editReply({ embeds: [successEmbed("Memory removed", `\`${id}\` deleted.`)] });
}

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Inspect the organization's stored knowledge")
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription("Semantic search over long-term memory")
        .addStringOption((o) => o.setName("query").setDescription("Search query").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("recent").setDescription("Show the latest memory entries"))
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Delete a memory entry")
        .addStringOption((o) => o.setName("id").setDescription("Memory entry id").setRequired(true)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "search") return await search(interaction);
      if (sub === "recent") return await recent(interaction);
      if (sub === "remove") return await remove(interaction);
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Error", errorMessage(err))] });
    }
  },
};

export default command;
