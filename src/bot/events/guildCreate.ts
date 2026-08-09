import type { Client } from "discord.js";
import { ensureGuild } from "../../database/guilds.js";
import { logger } from "../../utils/logger.js";

export async function onGuildCreate(client: Client, guildId: string): Promise<void> {
  const guild = await ensureGuild(guildId);
  logger.info({ guildId, mode: guild.mode }, "joined new guild");
}
