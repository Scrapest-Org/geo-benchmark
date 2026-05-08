import { redis } from "@scrapest/config";
import { TcpRpcServer, TcpRpcClient } from "@scrapest/tcp-rpc";

const ITERATIONS = 1000;
const WARMUP = 50;

function computeStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { min, max, mean, p50, p95, p99 };
}

function printStats(label: string, stats: ReturnType<typeof computeStats>) {
  const fmt = (n: number) => n.toFixed(2) + "ms";
  console.log(label);
  console.log(`  min:    ${fmt(stats?.min ?? 0)}`);
  console.log(`  max:    ${fmt(stats?.max ?? 0)}`);
  console.log(`  mean:   ${fmt(stats?.mean ?? 0)}`);
  console.log(`  p50:    ${fmt(stats?.p50 ?? 0)}`);
  console.log(`  p95:    ${fmt(stats?.p95 ?? 0)}`);
  console.log(`  p99:    ${fmt(stats?.p99 ?? 0)}`);
}

async function benchTcpRpc(): Promise<number[]> {
  const server = new TcpRpcServer({ port: 19998 });
  server.listen();
  const client = new TcpRpcClient({ host: "127.0.0.1", port: 19998 });
  await client.connect();

  const samples: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    let handler: ((data: unknown) => void) | null = null;

    const latency = await new Promise<number>((resolve) => {
      handler = (data) => {
        resolve(performance.now() - (data as { t0: number }).t0);
      };
      client.on("bench", handler);
      server.broadcast("bench", { t0: performance.now() });
    });

    client.off("bench", handler!);

    if (i >= WARMUP) samples.push(latency);
    await Bun.sleep(5);
  }

  client.destroy();
  server.stop();
  return samples;
}

async function benchRedis(): Promise<number[] | null> {
  const sub = redis.duplicate();
  try {
    await sub.subscribe("bench");
  } catch {
    redis.disconnect();
    sub.disconnect();
    return null;
  }

  const samples: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    let handler: ((channel: string, message: string) => void) | null = null;

    const latency = await new Promise<number>((resolve) => {
      handler = (channel, message) => {
        if (channel !== "bench") return;
        const { t0 } = JSON.parse(message);
        resolve(performance.now() - t0);
      };
      sub.on("message", handler);
      redis.publish("bench", JSON.stringify({ t0: performance.now() }));
    });

    sub.off("message", handler!);

    if (i >= WARMUP) samples.push(latency);
    await Bun.sleep(5);
  }

  redis.disconnect();
  sub.disconnect();
  return samples;
}

async function main() {
  console.log("Running tcp-rpc benchmark...");
  const tcpRpcSamples = await benchTcpRpc();

  console.log("Running Redis benchmark...");
  const redisSamples = await benchRedis();

  console.log("\n=== Latency Benchmark (950 samples each) ===\n");

  const tcpStats = computeStats(tcpRpcSamples);
  printStats("tcp-rpc pub-sub", tcpStats);

  if (redisSamples) {
    const redisStats = computeStats(redisSamples);
    printStats("\nredis pub-sub", redisStats);

    const ratio = redisStats.mean / tcpStats.mean;
    console.log(`\ntcp-rpc is ${ratio.toFixed(1)}x faster than redis (mean)`);
  } else {
    console.log("\nRedis unavailable — skipping redis benchmark");
  }

  process.exit(0);
}

main();
