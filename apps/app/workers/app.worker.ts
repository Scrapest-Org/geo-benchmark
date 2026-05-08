import { client } from "../routes";
import { InternalService } from "../services/internal";

const internal = new InternalService();

client.on("dispatch-events", async (data: unknown) => {
  try {
    const { payload } = data as { payload: any };
    if (!payload || !payload.length) throw new Error("No payload provided");

    await internal.handleDispatch(payload);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(`Failed to dispatch events: ${e.message}`);
  }
});
