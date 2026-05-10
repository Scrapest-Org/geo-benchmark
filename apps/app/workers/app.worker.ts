import { tcpRpcServer } from "../lib/rpc";
import { InternalService } from "../services/internal";

const internal = new InternalService();

tcpRpcServer.on("dispatch-events", async (data: unknown) => {
  const { payload, app } = data as { payload: any; app: string };
  console.log(app, Date.now());
  try {
    if (!payload || !payload.length) throw new Error("No payload provided");

    // await internal.handleDispatch(payload);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(`Failed to dispatch events: ${e.message}`);
  }
});
