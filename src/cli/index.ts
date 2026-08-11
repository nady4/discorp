#!/usr/bin/env node
import "dotenv/config";
import { prisma } from "../database/prisma.js";
import { redis } from "../database/redis.js";
import { registry } from "../agents/index.js";
import { ensureGuild, syncAgentCatalog } from "../database/guilds.js";
import { parseMode, modeLevel } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * DisCorp CLI — manage organizations and agents without Discord.
 *
 *   discorp org add <guildId>            register an organization
 *   discorp org list                     list all organizations
 *   discorp org set-mode <guildId> <1|2|3>
 *   discorp agent add <id> <name> <role> [persona]
 *   discorp agent list
 *   discorp status [guildId]
 */

const [command, sub, ...args] = process.argv.slice(2);

const USAGE = [
  "usage: discorp <command>",
  "",
  "  org add <guildId>                  register an organization",
  "  org list                           list organizations",
  "  org set-mode <guildId> <1|2|3>     change org intensity",
  "  agent add <id> <name> <role>       create a custom agent definition",
  "  agent list                         list loaded agents",
  "  status [guildId]                   org status overview",
].join("\n");

function validCommand(): boolean {
  if (command === "org") return sub === "add" || sub === "list" || sub === "set-mode";
  if (command === "agent") return sub === "add" || sub === "list";
  return command === "status";
}

async function orgAdd(): Promise<void> {
  const guildId = args[0];
  if (!guildId) throw new Error("usage: discorp org add <guildId>");
  const guild = await ensureGuild(guildId);
  console.log(`Organization ${guild.id} registered (mode ${guild.mode}, budget $${(guild.maxMonthlyBudgetCents / 100).toFixed(2)}/mo).`);
}

async function orgList(): Promise<void> {
  const guilds = await prisma.guild.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  if (guilds.length === 0) {
    console.log("No organizations registered yet.");
    return;
  }
  for (const g of guilds) {
    const agentCount = await prisma.guildAgent.count({ where: { guildId: g.id } });
    console.log(`${g.id}  mode=${g.mode}  budget=$${(g.maxMonthlyBudgetCents / 100).toFixed(2)}  agents=${agentCount}  sleep=${g.sleepMode ? "yes" : "no"}`);
  }
}

async function orgSetMode(): Promise<void> {
  const [guildId, raw] = args;
  if (!guildId || !raw) throw new Error("usage: discorp org set-mode <guildId> <1|2|3|lightweight|standard|autonomous>");
  const mode = parseMode(raw);
  if (!mode) throw new Error(`Invalid mode '${raw}'. Use 1, 2, 3 or lightweight/standard/autonomous.`);
  await prisma.guild.update({ where: { id: guildId }, data: { mode } });
  console.log(`Organization ${guildId} → ${mode} (level ${modeLevel(mode)}).`);
}

async function agentAdd(): Promise<void> {
  const [id, name, role, persona] = args;
  if (!id || !name || !role) throw new Error("usage: discorp agent add <id> <name> <role> [persona]");
  const definition = await registry.addCustomAgent({
    id: id.toLowerCase(),
    name,
    role,
    persona: persona ?? `You are ${name}, the ${role}. Be concise and precise.`,
    responsibilities: [],
    tools: ["memory", "report", "filesystem", "web_search"],
    description: "",
    permissions: [],
    modeMin: 1,
    isCore: false,
  });
  await syncAgentCatalog();
  console.log(`Agent '${definition.id}' written to ${registry.getEntry(definition.id)?.sourcePath}.`);
}

async function agentList(): Promise<void> {
  await registry.load();
  for (const entry of registry.all) {
    const def = entry.definition;
    console.log(`${def.id}  ${def.name} — ${def.role}  modeMin=${def.modeMin}  tools=[${def.tools.join(",")}]  ${def.custom ? "(custom)" : ""}`);
  }
}

async function status(): Promise<void> {
  const guildId = args[0];
  const guilds = guildId ? await prisma.guild.findMany({ where: { id: guildId } }) : await prisma.guild.findMany({ take: 20 });
  if (guilds.length === 0) {
    console.log("No organizations found.");
    return;
  }
  for (const g of guilds) {
    const [goals, tasks, usage, agentCount] = await Promise.all([
      prisma.goal.count({ where: { guildId: g.id } }),
      prisma.task.count({ where: { guildId: g.id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS", "IN_REVIEW"] } } }),
      prisma.usageSummary.findUnique({
        where: { guildId_period_granularity: { guildId: g.id, period: new Date().toISOString().slice(0, 7), granularity: "MONTH" } },
      }),
      prisma.guildAgent.count({ where: { guildId: g.id } }),
    ]);
    const spent = ((usage?.costCents ?? 0) / 100).toFixed(2);
    console.log(`${g.id}  mode=${g.mode}  agents=${agentCount}  goals=${goals}  openTasks=${tasks}  spentThisMonth=$${spent}`);
  }
}

async function main(): Promise<void> {
  if (!validCommand()) {
    console.log(USAGE);
    return;
  }
  await prisma.$connect();
  try {
    if (command === "org") {
      if (sub === "add") return await orgAdd();
      if (sub === "list") return await orgList();
      if (sub === "set-mode") return await orgSetMode();
    }
    if (command === "agent") {
      if (sub === "add") return await agentAdd();
      if (sub === "list") return await agentList();
    }
    if (command === "status") return await status();
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "cli failed");
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
