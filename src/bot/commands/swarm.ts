import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { swarmRun, saveSwarmReport } from "../../orchestration/index.js";
import { errorEmbed, infoEmbed, sendLong, successEmbed, truncate } from "../../utils/discord.js";
import { userMessage } from "../../utils/errors.js";
import type { CommandModule } from "./types.js";

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("swarm")
    .setDescription("Run a swarm session: multiple agents tackle a prompt in parallel")
    .addStringOption((o) => o.setName("prompt").setDescription("The question or brief for the swarm").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("agents")
        .setDescription("Comma-separated agent ids (default: cto,developer,qa,security)"),
    )
    .addBooleanOption((o) => o.setName("merge").setDescription("Merge perspectives with a CEO synthesis (default true)")),
  async execute(interaction) {
    const prompt = interaction.options.getString("prompt", true);
    const rawAgents = interaction.options.getString("agents") ?? "cto,developer,qa,security";
    const merge = interaction.options.getBoolean("merge") ?? true;
    const guildId = interaction.guildId!;

    const agentIds = rawAgents.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    await interaction.editReply({ embeds: [infoEmbed("🐝 Swarm session", `**${prompt.slice(0, 100)}**\nAgents: ${agentIds.join(", ")} — running in parallel…`)] });

    try {
      const result = await swarmRun({ guildId, prompt, agentIds, merge });
      const reportId = await saveSwarmReport(guildId, { guildId, prompt, agentIds, merge }, result);

      const lines = [
        ...result.runs.map((r) => `**${r.agentId}**${r.failed ? " ⚠️" : ""}:\n${truncate(r.content, 700)}`),
        result.merged ? ["", `**Synthesis (CEO)**:`, truncate(result.merged, 1200)] : [],
      ].flat();
      await sendLong(interaction, lines.join("\n\n").slice(0, 5900));
      await interaction.followUp({
        embeds: [successEmbed("Swarm complete", `Full report saved as \`${reportId}\` — view with /memory report.`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Swarm failed", userMessage(err))] });
    }
  },
  adminOnly: true,
  rateLimited: true,
};

export default command;
