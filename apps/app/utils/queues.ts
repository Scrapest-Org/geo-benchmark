import { connection, getEnv, opts } from "@scrapest/config";
import { Queue } from "bullmq";

const vm = getEnv("VM_NAME");

export const xQueue = new Queue(`${vm}-x`, {
  connection: connection,
  defaultJobOptions: opts,
});
export const appQueue = new Queue(`${vm}-app`, {
  connection: connection,
  defaultJobOptions: opts,
});
export const webpushQueue = new Queue(`${vm}-webpush`, {
  connection: connection,
  defaultJobOptions: opts,
});

export const closeQueues = async () => {
  console.log("Closing BullMQ connections...");
  await Promise.all([xQueue.close(), appQueue.close(), webpushQueue.close()]);
};
