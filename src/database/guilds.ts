import { GuildMode, type Guild } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "../config/index.js";
import { registry } from "../agents/index.js";
import { logger } from "../utils/logger.js";

const MODE_MAP: Record<string, GuildMode> = {
  lightweight: GuildMode.LIGHTWEIGHT,
  standard: GuildMode.STANDARD,
  autonomous: GuildMode.AUTONOMOUS,
};

/** Upsert guild org state with env-configured defaults. */
export async function ensureGuild(guildId: string): Promise<Guild> {
  const guild = await prisma.guild.upsert({
    where: { id: guildId },
    create: {
      id: guildId,
      mode: MODE_MAP[env.DEFAULT_GUILD_MODE] ?? GuildMode.STANDARD,
      maxMonthlyBudgetCents: Math.round(env.DEFAULT_MONTHLY_BUDGET * 100),
      maxExecutionsPerDay: env.DEFAULT_MAX_EXECUTIONS_PER_DAY,
    },
    update: {},
  });
  await syncGuildAgents(guildId);
  return guild;
}

/** Upsert all registry agents into the Agent catalog. */
export async function syncAgentCatalog(): Promise<void> {
  for (const entry of registry.all) {
    const def = entry.definition;
    await prisma.agent.upsert({
      where: { id: def.id },
      create: {
        id: def.id,
        name: def.name,
        role: def.role,
        source: def.custom ? "CUSTOM" : "BUILTIN",
        config: def as unknown as object,
        active: true,
        modeMin: def.modeMin,
      },
      update: {
        name: def.name,
        role: def.role,
        source: def.custom ? "CUSTOM" : "BUILTIN",
        config: def as unknown as object,
        active: true,
        modeMin: def.modeMin,
      },
    });
  }
  // Deactivate agents that disappeared from disk
  const known = registry.all.map((e) => e.definition.id);
  await prisma.agent.updateMany({
    where: { active: true, id: { notIn: known } },
    data: { active: false },
  });
  logger.info({ count: registry.all.length }, "agent catalog synced");
}

/** Ensure GuildAgent rows exist for every registry agent in this guild. */
export async function syncGuildAgents(guildId: string): Promise<void> {
  const existing = await prisma.guildAgent.findMany({ where: { guildId } });
  const have = new Set(existing.map((ga) => ga.agentId));
  const missing = registry.all.filter((e) => !have.has(e.definition.id));
  if (missing.length) {
    await prisma.guildAgent.createMany({
      data: missing.map((e) => ({ guildId, agentId: e.definition.id, enabled: true })),
      skipDuplicates: true,
    });
  }
}
