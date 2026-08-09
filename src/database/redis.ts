import { Redis } from "ioredis";
import { env } from "../config/index.js";

declare global {
  // eslint-disable-next-line no-var
  var __discorpRedis: Redis | undefined;
}

export const redis: Redis =
  global.__discorpRedis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== "production") {
  global.__discorpRedis = redis;
}
