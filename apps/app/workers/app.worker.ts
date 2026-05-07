import { Worker, type Job } from "bullmq";
import { connection } from "@scrapest/config";
import { InternalService } from "../services/internal";

type JobNames = "dispatch-events";

export const appWorker = new Worker(
  "app",
  async (job: Job<any, any, JobNames>) => {
    const internal = new InternalService();
    const { name, data } = job;
    switch (name) {
      case "dispatch-events": {
        const { payload } = data as { payload: any[] };
        if (!payload) throw new Error("No payload provided");

        await internal.handleDispatch(payload);
        break;
      }
      default:
        console.error(`Unknown job name: ${name}`);
        break;
    }
  },
  { connection, concurrency: 3 },
);

appWorker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`App Job ${job?.id} failed: ${err.message}`);
});
