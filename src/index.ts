import "dotenv/config";
import { client, buildClient } from "./bot/client.js";
import { wireEvents } from "./bot/index.js";
import { prisma } from "./database/prisma.js";
import { registerTools, registry } from "./agents/index.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("connected to PostgreSQL");

  registerTools();
  await registry.load();

  wireEvents(client);
  buildClient();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
