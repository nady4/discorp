import "dotenv/config";
import { client, buildClient } from "./bot/client.js";
import { wireEvents } from "./bot/index.js";
import { prisma } from "./database/prisma.js";
import { redis } from "./database/redis.js";
import { closeQueues } from "./workers/index.js";
import { registerTools, registry } from "./agents/index.js";
import { loadPlugins } from "./plugins/index.js";
import { startServer } from "./server/index.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("connected to PostgreSQL");

  registerTools();
  await registry.load();
  await loadPlugins();

  await wireEvents(client);
  buildClient();

  void startServer().catch((err) => {
    logger.error({ err }, "dashboard server failed to start");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await Promise.allSettled([
      client.destroy(),
      closeQueues(),
      redis.quit(),
      prisma.$disconnect(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
