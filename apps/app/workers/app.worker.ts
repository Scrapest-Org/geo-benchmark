import { redis } from "@scrapest/config";
import { InternalService } from "../services/internal";

const internal = new InternalService();

const sub = redis.duplicate();
await sub.subscribe("dispatch-events");

sub.on("message", async (_channel, message) => {
  const { payload } = JSON.parse(message);
  if (!payload || !payload.length) throw new Error("No payload provided");

  await internal.handleDispatch(payload);
});
