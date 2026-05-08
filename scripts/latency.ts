import { SourceMapping } from "apps/app/services/mapping";
import { redis } from "bun";

for (let i = 0; i < 5; i++) {
  console.time("latency");
  console.time("rk");
  const rk = SourceMapping.getRK("x", "1457620134546268160");
  console.timeEnd("rk");
  console.time("smembers");
  const apikeys = await redis.smembers(rk);
  console.timeEnd("smembers");

  console.log(apikeys);
  console.timeEnd("latency");
}
