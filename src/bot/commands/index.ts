import { Collection } from "discord.js";
import type { CommandModule } from "./types.js";
import help from "./help.js";
import goals from "./goals.js";
import review from "./review.js";
import agents from "./agents.js";
import assign from "./assign.js";
import status from "./status.js";
import memory from "./memory.js";
import config from "./config.js";
import balance from "./balance.js";

export const commands = new Collection<string, CommandModule>();

export function registerCommands(): void {
  const modules: CommandModule[] = [help, goals, review, agents, assign, status, memory, config, balance];
  for (const mod of modules) {
    commands.set(mod.data.name, mod);
  }
}
