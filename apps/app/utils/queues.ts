import { connection, opts } from "@scrapest/config";
import { Queue } from "bullmq";

export const xQueue = new Queue("x", {
  connection: connection,
  defaultJobOptions: opts,
});
export const appQueue = new Queue("app", {
  connection: connection,
  defaultJobOptions: opts,
});
export const webpushQueue = new Queue("webpush", {
  connection: connection,
  defaultJobOptions: opts,
});

export const closeQueues = async () => {
  console.log("Closing BullMQ connections...");
  await Promise.all([xQueue.close(), appQueue.close(), webpushQueue.close()]);
};
