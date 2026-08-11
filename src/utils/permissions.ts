import type { GuildMember } from "discord.js";
import { env } from "../config/index.js";

/** Admin check: bot owner (ADMIN_USER_IDS) or Manage Server permission. */
export function isAdmin(member: GuildMember | null, userId: string): boolean {
  if (env.ADMIN_USER_IDS.length && env.ADMIN_USER_IDS.includes(userId)) return true;
  return member?.permissions.has("ManageGuild") ?? false;
}
