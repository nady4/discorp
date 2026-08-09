import "dotenv/config";
import { registry, registerTools } from "../src/agents/index.js";
import { prisma } from "../src/database/prisma.js";
import { syncAgentCatalog } from "../src/database/guilds.js";
import { logger } from "../src/utils/logger.js";

/**
 * Seed the database: syncs the agent catalog from agent.json files.
 * Guild rows are created on-demand when the bot joins a server.
 */
async function main(): Promise<void> {
  registerTools();
  await registry.load();
  await syncAgentCatalog();
  logger.info("seed complete");
}

main()
  .catch((err) => {
    logger.error({ err }, "seed failed");
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
