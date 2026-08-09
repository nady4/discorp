import { Queue } from "bullmq";
import { redis } from "../database/redis.js";

export const REVIEW_QUEUE = "discorp-review";
export const AUTONOMOUS_QUEUE = "discorp-autonomous";

export const reviewQueue = new Queue(REVIEW_QUEUE, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
});

export const autonomousQueue = new Queue(AUTONOMOUS_QUEUE, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
});

export async function closeQueues(): Promise<void> {
  await reviewQueue.close();
  await autonomousQueue.close();
}
