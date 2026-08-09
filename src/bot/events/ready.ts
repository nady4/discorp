import type { Client } from "discord.js";
import { registry, registerTools } from "../../agents/index.js";
import { ensureGuild, syncAgentCatalog } from "../../database/guilds.js";
import { logger } from "../../utils/logger.js";
import { startScheduler } from "../../workers/scheduler.js";
import { registerSlashCommands } from "./readyHelpers.js";

export async function onReady(client: Client): Promise<void> {
  logger.info({ user: client.user?.tag }, "Discord bot ready");

  // Warm up the provider config early so misconfigs fail fast at boot
  try {
    const { createChatProvider } = await import("../../providers/index.js");
    createChatProvider();
  } catch (err) {
    logger.error({ err }, "AI provider configuration error — check AI_PROVIDER/AI_API_KEY/AI_MODEL");
  }

  registerTools();
  await registry.load();
  await syncAgentCatalog();

  // Ensure every guild the bot is in has org state
  for (const guild of client.guilds.cache.values()) {
    await ensureGuild(guild.id);
  }

  await registerSlashCommands(client.user!.id);
  await client.user?.setActivity("a virtual AI company", { type: 3 }); // WATCHING

  startScheduler();
}
