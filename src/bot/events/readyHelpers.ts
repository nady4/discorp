import { REST, Routes } from "discord.js";
import { env } from "../../config/index.js";
import { commands } from "../commands/index.js";
import { logger } from "../../utils/logger.js";

/** Register all slash commands with the Discord API (global scope). */
export async function registerSlashCommands(clientId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const body = commands.map((c) => c.data.toJSON());
  try {
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger.info({ count: body.length }, "slash commands registered");
  } catch (err) {
    logger.error({ err }, "command registration failed");
    throw err;
  }
}
