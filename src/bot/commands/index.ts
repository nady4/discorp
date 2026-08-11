import { Collection } from "discord.js";
import type { CommandModule } from "./types.js";
import { logger } from "../../utils/logger.js";

export const commands = new Collection<string, CommandModule>();

/**
 * Command modules are imported lazily so that a single malformed command
 * (e.g. an over-long description that Discord.js rejects) degrades to a
 * logged warning instead of crashing the whole bot at startup.
 */
const COMMAND_MODULES = [
  "./help.js",
  "./goals.js",
  "./review.js",
  "./agents.js",
  "./assign.js",
  "./status.js",
  "./memory.js",
  "./config.js",
  "./balance.js",
  "./chat.js",
  "./swarm.js",
] as const;

export async function registerCommands(): Promise<void> {
  for (const path of COMMAND_MODULES) {
    try {
      const mod = (await import(path)) as { default?: CommandModule };
      if (!mod.default?.data || typeof mod.default.execute !== "function") {
        logger.warn({ path }, "command module missing default export — skipping");
        continue;
      }
      commands.set(mod.default.data.name, mod.default);
    } catch (err) {
      logger.error({ err, path }, "failed to load command — skipping");
    }
  }
  logger.info({ count: commands.size }, "commands registered");
}
