import "dotenv/config";
import { client, buildClient } from "./bot/client.js";
import { prisma } from "./database/prisma.js";
import { registerTools, registry } from "./agents/index.js";
import { startWorkers, closeQueues } from "./workers/index.js";
import { syncAgentCatalog } from "./database/guilds.js";
import { logger } from "./utils/logger.js";

/**
 * Worker process entrypoint: runs BullMQ workers for scheduled reviews and
 * autonomous sessions. Logs into Discord so reports can be posted to guilds.
 */
async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("connected to PostgreSQL (worker)");

  registerTools();
  await registry.load();
  await syncAgentCatalog();

  startWorkers();
  buildClient();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during worker startup");
  process.exit(1);
});
