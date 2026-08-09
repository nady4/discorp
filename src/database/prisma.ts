import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __discorpPrisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client. In development (tsx watch) a global prevents
 * connection exhaustion on hot reloads.
 */
export const prisma =
  global.__discorpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__discorpPrisma = prisma;
}
