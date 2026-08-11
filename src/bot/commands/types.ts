import type { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder } from "discord.js";

export type CommandData = SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;

export interface CommandModule {
  data: CommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Restrict to bot owner (ADMIN_USER_IDS) or users with Manage Server. */
  adminOnly?: boolean;
  /** Enforce the per-user command rate limit (AI-costing commands). */
  rateLimited?: boolean;
}
