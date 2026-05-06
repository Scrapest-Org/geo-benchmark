import { connection, opts } from "@scrapest/config";
import { Queue } from "bullmq";

export const discordQueue = new Queue("discord", {
  connection: connection,
  defaultJobOptions: opts,
});
export const telegramQueue = new Queue("telegram", {
  connection: connection,
  defaultJobOptions: opts,
});
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
export const backfillQueue = new Queue("backfill", {
  connection: connection,
  defaultJobOptions: opts,
});

export const closeQueues = async () => {
  console.log("Closing BullMQ connections...");
  await Promise.all([
    discordQueue.close(),
    xQueue.close(),
    telegramQueue.close(),
    appQueue.close(),
    webpushQueue.close(),
    backfillQueue.close(),
  ]);
};
