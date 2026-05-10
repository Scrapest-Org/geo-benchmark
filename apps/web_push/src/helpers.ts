import { connection, getEnv, opts } from "@scrapest/config";
import { UserCache } from "@scrapest/core/cache";
import { Queue } from "bullmq";

const userCache = new UserCache("webpush");
const vm = getEnv("VM_NAME");

const webpushQueue = new Queue(`${vm}-webpush`, {
  connection,
  defaultJobOptions: opts,
});

export { userCache, webpushQueue };
