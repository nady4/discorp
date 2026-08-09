import type { Client, ChatInputCommandInteraction } from "discord.js";
import { commands } from "./commands/index.js";
import { registerCommands } from "./commands/index.js";
import { onReady } from "./events/ready.js";
import { onInteractionCreate } from "./events/interactionCreate.js";
import { onGuildCreate } from "./events/guildCreate.js";
import { logger } from "../utils/logger.js";

export function wireEvents(client: Client): void {
  registerCommands();

  client.once("ready", (c) => {
    void onReady(c);
  });

  client.on("guildCreate", (guild) => {
    void onGuildCreate(client, guild.id);
  });

  client.on("interactionCreate", (interaction) => {
    if (interaction.isChatInputCommand() && commands.has(interaction.commandName)) {
      void onInteractionCreate(interaction as ChatInputCommandInteraction);
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "discord client error");
  });
}
