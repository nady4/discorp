import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { env, parseMode } from "../../config/index.js";
import { registry } from "../../agents/index.js";
import { syncAgentCatalog, syncGuildAgents } from "../../database/guilds.js";
import { refreshSchedules } from "../../workers/scheduler.js";
import { errorEmbed, infoEmbed, successEmbed } from "../../utils/discord.js";
import { userMessage } from "../../utils/errors.js";
import { AGENT_TOOL_NAMES } from "../../agents/types.js";
import type { CommandModule } from "./types.js";

function isAdmin(member: GuildMember | null, userId: string): boolean {
  if (env.ADMIN_USER_IDS.length && env.ADMIN_USER_IDS.includes(userId)) return true;
  return member?.permissions.has("ManageGuild") ?? false;
}

async function setMode(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString("mode", true);
  const mode = parseMode(raw);
  if (!mode) {
    await interaction.editReply({ embeds: [errorEmbed("Invalid mode", "Use 1, 2, 3 or lightweight/standard/autonomous.")] });
    return;
  }
  const guildId = interaction.guildId!;
  await prisma.guild.update({ where: { id: guildId }, data: { mode } });
  await interaction.editReply({
    embeds: [successEmbed("Mode updated", `Organization intensity set to **${mode}**. Level ${parseMode(raw)}. Agents and workers adjust accordingly.`)],
  });
  void syncGuildAgents(guildId);
  refreshSchedules();
}

async function setBudget(interaction: ChatInputCommandInteraction) {
  const usd = interaction.options.getNumber("usd", true);
  if (usd < 0) {
    await interaction.editReply({ embeds: [errorEmbed("Invalid budget", "Budget must be >= 0.")] });
    return;
  }
  const guildId = interaction.guildId!;
  await prisma.guild.update({ where: { id: guildId }, data: { maxMonthlyBudgetCents: Math.round(usd * 100) } });
  await interaction.editReply({ embeds: [successEmbed("Budget updated", `Monthly budget set to **$${usd.toFixed(2)}**.`)] });
}

async function setSleep(interaction: ChatInputCommandInteraction) {
  const state = interaction.options.getString("state", true);
  const agentId = interaction.options.getString("agent");
  const guildId = interaction.guildId!;
  const on = state === "on";

  if (agentId) {
    const exists = registry.get(agentId);
    if (!exists) {
      await interaction.editReply({ embeds: [errorEmbed("Unknown agent", agentId)] });
      return;
    }
    const data = on ? { sleepUntil: new Date(Date.now() + 12 * 3600 * 1000) } : { sleepUntil: null };
    await prisma.guildAgent.upsert({
      where: { guildId_agentId: { guildId, agentId } },
      create: { guildId, agentId, enabled: true, ...data },
      update: data,
    });
    await interaction.editReply({
      embeds: [successEmbed(on ? "😴 Agent sleeping" : "☀️ Agent awake", `**${agentId}** ${on ? "is asleep for 12 hours." : "is awake."}`)],
    });
    return;
  }

  await prisma.guild.update({ where: { id: guildId }, data: { sleepMode: on } });
  await interaction.editReply({
    embeds: [successEmbed(on ? "😴 Organization asleep" : "☀️ Organization awake", on ? "All autonomous work is paused." : "Work can resume.")],
  });
  refreshSchedules();
}

async function setWake(interaction: ChatInputCommandInteraction) {
  const agentId = interaction.options.getString("agent");
  const guildId = interaction.guildId!;

  if (agentId) {
    await prisma.guildAgent.upsert({
      where: { guildId_agentId: { guildId, agentId } },
      create: { guildId, agentId, enabled: true },
      update: { sleepUntil: null },
    });
    await interaction.editReply({ embeds: [successEmbed("☀️ Agent awake", `**${agentId}** is awake.`)] });
    return;
  }

  await prisma.guild.update({ where: { id: guildId }, data: { sleepMode: false } });
  await interaction.editReply({ embeds: [successEmbed("☀️ Organization awake", "Work can resume.")] });
  refreshSchedules();
}

async function setChannel(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guildId!;
  await prisma.guild.update({ where: { id: guildId }, data: { configChannelId: channel.id } });
  await interaction.editReply({ embeds: [successEmbed("Channel set", `Scheduled reports will be posted to <#${channel.id}>.`)] });
}

async function showProvider(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  const overrides = (guild?.providerOverrides ?? {}) as Record<string, unknown>;
  await interaction.editReply({
    embeds: [
      infoEmbed(
        "🔌 AI provider",
        [
          `**Provider**: ${env.AI_PROVIDER}`,
          `**Model**: ${env.AI_MODEL}`,
          `**Base URL**: ${env.AI_BASE_URL ?? "(default)"}`,
          `**Embeddings**: ${env.AI_EMBEDDING_PROVIDER ?? env.AI_PROVIDER} / ${env.AI_EMBEDDING_MODEL}`,
          overrides.provider ? `**Guild override**: ${overrides.provider} / ${overrides.model ?? env.AI_MODEL}` : `**Guild override**: none (global BYOK config)`,
          overrides.provider ? "Clear it with /config provider clear." : "Set one with /config provider set.",
        ].join("\n"),
      ),
    ],
  });
}

async function setProviderOverride(interaction: ChatInputCommandInteraction) {
  const provider = interaction.options.getString("provider", true);
  const model = interaction.options.getString("model");
  const baseUrl = interaction.options.getString("baseurl");
  const apiKey = interaction.options.getString("apikey");
  if (!["openai", "anthropic", "gemini", "ollama"].includes(provider)) {
    await interaction.editReply({ embeds: [errorEmbed("Invalid provider", "Use openai, anthropic, gemini or ollama.")] });
    return;
  }
  const guildId = interaction.guildId!;
  const current = ((await prisma.guild.findUnique({ where: { id: guildId } }))?.providerOverrides ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current, provider };
  if (model) next.model = model;
  if (baseUrl) next.baseUrl = baseUrl;
  if (apiKey) next.apiKey = apiKey;
  await prisma.guild.update({ where: { id: guildId }, data: { providerOverrides: next as Prisma.InputJsonValue } });
  await interaction.editReply({
    embeds: [successEmbed("Provider override saved", `**${provider}**${model ? ` / ${model}` : ""}. This guild now uses its own provider config.`)],
  });
}

async function clearProviderOverride(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  await prisma.guild.update({ where: { id: guildId }, data: { providerOverrides: Prisma.JsonNull } });
  await interaction.editReply({ embeds: [successEmbed("Provider override cleared", "This guild uses the global BYOK config again.")] });
}

async function reloadAgents(interaction: ChatInputCommandInteraction) {
  await registry.load();
  await syncAgentCatalog();
  const guildId = interaction.guildId!;
  await syncGuildAgents(guildId);
  await interaction.editReply({
    embeds: [successEmbed("Agents reloaded", `Loaded ${registry.all.length} agent definitions from disk.`)],
  });
}

async function newAgent(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getString("id", true).toLowerCase();
  const name = interaction.options.getString("name", true);
  const role = interaction.options.getString("role", true);
  const persona = interaction.options.getString("persona", true);
  const responsibilities = (interaction.options.getString("responsibilities") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const tools = (interaction.options.getString("tools") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((t): t is (typeof AGENT_TOOL_NAMES)[number] => AGENT_TOOL_NAMES.includes(t as (typeof AGENT_TOOL_NAMES)[number]));

  if (!/^[a-z0-9-_]{1,32}$/.test(id)) {
    await interaction.editReply({ embeds: [errorEmbed("Invalid id", "Use lowercase letters, numbers, dashes (max 32 chars).")] });
    return;
  }

  const definition = await registry.addCustomAgent({
    id,
    name,
    role,
    persona,
    responsibilities,
    tools,
    description: "",
    permissions: [],
    modeMin: 1,
    isCore: false,
  });
  await syncAgentCatalog();
  await syncGuildAgents(interaction.guildId!);
  await interaction.editReply({
    embeds: [successEmbed("Custom agent created", `**${name}** (${id}) is now part of the organization.\nPersona: ${definition.persona.slice(0, 200)}`)],
  });
}

export const command: CommandModule = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure the organization (admin)")
    .addSubcommand((s) =>
      s
        .setName("mode")
        .setDescription("Set organization intensity: 1 lightweight, 2 standard, 3 autonomous")
        .addStringOption((o) => o.setName("mode").setDescription("1 | 2 | 3").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("budget")
        .setDescription("Set max monthly budget in USD")
        .addNumberOption((o) => o.setName("usd").setDescription("Monthly budget in USD").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("sleep")
        .setDescription("Put the org (or one agent) to sleep for 12 hours")
        .addStringOption((o) =>
          o
            .setName("state")
            .setDescription("on or off")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
        )
        .addStringOption((o) => o.setName("agent").setDescription("Agent id (optional — sleeps only this agent)")),
    )
    .addSubcommand((s) =>
      s
        .setName("wake")
        .setDescription("Wake the org or one agent")
        .addStringOption((o) => o.setName("agent").setDescription("Agent id (optional — wakes only this agent)")),
    )
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set channel where scheduled reports are posted")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("provider").setDescription("Show the active AI provider and model"))
    .addSubcommand((s) =>
      s
        .setName("provider-set")
        .setDescription("Set a per-guild provider override")
        .addStringOption((o) =>
          o
            .setName("provider")
            .setDescription("openai | anthropic | gemini | ollama")
            .setRequired(true)
            .addChoices(
              { name: "openai", value: "openai" },
              { name: "anthropic", value: "anthropic" },
              { name: "gemini", value: "gemini" },
              { name: "ollama", value: "ollama" },
            ),
        )
        .addStringOption((o) => o.setName("model").setDescription("Model id for this guild")),
    )
    .addSubcommand((s) => s.setName("provider-clear").setDescription("Clear the per-guild provider override"))
    .addSubcommand((s) => s.setName("agents").setDescription("Reload agent definitions from disk"))
    .addSubcommand((s) =>
      s
        .setName("new-agent")
        .setDescription("Register a custom agent")
        .addStringOption((o) => o.setName("id").setDescription("Agent id, e.g. sales").setRequired(true))
        .addStringOption((o) => o.setName("name").setDescription("Display name, e.g. Sales").setRequired(true))
        .addStringOption((o) => o.setName("role").setDescription("Role, e.g. Sales Lead").setRequired(true))
        .addStringOption((o) => o.setName("persona").setDescription("System prompt persona").setRequired(true))
        .addStringOption((o) => o.setName("responsibilities").setDescription("Comma-separated responsibilities"))
        .addStringOption((o) => o.setName("tools").setDescription(`Comma-separated tools: ${AGENT_TOOL_NAMES.join(", ")}`)),
    ),
  async execute(interaction) {
    const member = interaction.member as GuildMember | null;
    if (!isAdmin(member, interaction.user.id)) {
      await interaction.editReply({
        embeds: [errorEmbed("No permission", "Only the bot owner (ADMIN_USER_IDS) or users with Manage Server permission can configure the organization.")],
      });
      return;
    }
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "mode") return await setMode(interaction);
      if (sub === "budget") return await setBudget(interaction);
      if (sub === "sleep") return await setSleep(interaction);
      if (sub === "wake") return await setWake(interaction);
      if (sub === "channel") return await setChannel(interaction);
      if (sub === "provider") return await showProvider(interaction);
      if (sub === "provider-set") return await setProviderOverride(interaction);
      if (sub === "provider-clear") return await clearProviderOverride(interaction);
      if (sub === "agents") return await reloadAgents(interaction);
      if (sub === "new-agent") return await newAgent(interaction);
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed("Error", userMessage(err))] });
    }
  },
  adminOnly: true,
};

export default command;
