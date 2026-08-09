import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { registry } from "../../agents/index.js";
import { modeLevel } from "../../config/index.js";
import { infoEmbed } from "../../utils/discord.js";
import type { CommandModule } from "./types.js";

export const command: CommandModule = {
  data: new SlashCommandBuilder().setName("agents").setDescription("List available agents"),
  async execute(interaction) {
    const guildId = interaction.guildId!;
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    const level = guild ? modeLevel(guild.mode) : 1;

    const guildAgents = await prisma.guildAgent.findMany({ where: { guildId } });
    const states = new Map(guildAgents.map((ga) => [ga.agentId, ga]));
    const now = Date.now();

    const agents = registry.all
      .map(({ definition: a }) => {
        const state = states.get(a.id);
        const enabled = state?.enabled ?? true;
        const sleeping = state?.sleepUntil ? state.sleepUntil.getTime() > now : false;
        const activeHere = a.modeMin <= level && enabled && !sleeping;
        return {
          id: a.id,
          role: a.role,
          responsibilities: a.responsibilities,
          tools: a.tools,
          activeHere,
          sleeping,
          minLevel: a.modeMin,
          custom: a.custom,
        };
      })
      .sort((a, b) => a.minLevel - b.minLevel);

    const lines = [
      `**Organization intensity**: Level ${level}`,
      ``,
      ...agents.map((a) => {
        const badge = a.activeHere ? "🟢" : a.sleeping ? "😴" : "⚪";
        const tools = a.tools.length ? a.tools.join(", ") : "—";
        return `${badge} **${a.id}** — ${a.role}${a.custom ? " (custom)" : ""}\n   Responsibilities: ${a.responsibilities.join("; ")}\n   Tools: ${tools}`;
      }),
    ];

    await interaction.editReply({
      embeds: [infoEmbed("👥 Organization roster", lines.join("\n").slice(0, 4000))],
    });
  },
};

export default command;
