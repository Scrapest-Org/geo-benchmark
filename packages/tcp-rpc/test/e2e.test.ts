import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RPC_REGISTRY } from "@scrapest/tcp-rpc/src/registry";
import { encodeFrame, FrameDecoder } from "@scrapest/tcp-rpc/src/framing";
import { TcpRpcServer } from "@scrapest/tcp-rpc/src/server";
import { TcpRpcClient } from "@scrapest/tcp-rpc/src/client";

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Asserts a promise rejects with a message matching the given string/regex.
 * Using try/catch instead of .rejects.toThrow() because Bun's unhandled
 * rejection detector fires on rejections that originate from socket event
 * handlers before the test framework's catch handler runs.
 */
async function expectRejection(
  promise: Promise<unknown>,
  match: string | RegExp,
) {
  try {
    await promise;
    throw new Error("Expected promise to reject but it resolved");
  } catch (err) {
    const msg = (err as Error).message;
    if (typeof match === "string") {
      expect(msg).toBe(match);
    } else {
      expect(msg).toMatch(match);
    }
  }
}

function makeServer(port: number) {
  const server = new TcpRpcServer({ port });
  server.handle("add", async (params: any) => params[0] + params[1]);
  server.handle("echo", async (msg: any) => msg);
  server.handle("delay", async ({ ms }: any) => {
    await sleep(ms);
    return "done";
  });
  server.handle("fail", async () => {
    throw new Error("intentional handler error");
  });
  server.handle("identity", async (params: any) => params);
  return server;
}

// ─── Registry ───────────────────────────────────────────────────────────────

describe("Registry", () => {
  test("telegram service is defined", () => {
    expect(RPC_REGISTRY.telegram).toBeDefined();
  });

  test("telegram has valid host and port", () => {
    expect(typeof RPC_REGISTRY.telegram.host).toBe("string");
    expect(RPC_REGISTRY.telegram.host.length).toBeGreaterThan(0);
    expect(typeof RPC_REGISTRY.telegram.port).toBe("number");
    expect(RPC_REGISTRY.telegram.port).toBeGreaterThan(0);
    expect(RPC_REGISTRY.telegram.port).toBeLessThan(65536);
  });

  test("default telegram port is 4000", () => {
    expect(RPC_REGISTRY.telegram.port).toBe(4000);
  });
});

// ─── Framing ────────────────────────────────────────────────────────────────

describe("Framing", () => {
  test("encodes and decodes a simple object", () => {
    const payload = { hello: "world" };
    const frame = encodeFrame(payload);
    const decoder = new FrameDecoder();
    const msgs = decoder.feed(frame);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual(payload);
  });

  test("decodes multiple messages in a single chunk", () => {
    const a = encodeFrame({ n: 1 });
    const b = encodeFrame({ n: 2 });
    const c = encodeFrame({ n: 3 });

    const combined = Buffer.concat([a, b, c]);
    const decoder = new FrameDecoder();
    const msgs = decoder.feed(combined);

    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ n: 1 });
    expect(msgs[1]).toEqual({ n: 2 });
    expect(msgs[2]).toEqual({ n: 3 });
  });

  test("handles a message split across two chunks", () => {
    const frame = encodeFrame({ split: true });
    const half = Math.floor(frame.length / 2);

    const decoder = new FrameDecoder();
    const first = decoder.feed(frame.subarray(0, half));
    expect(first).toHaveLength(0);

    const second = decoder.feed(frame.subarray(half));
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({ split: true });
  });

  test("handles header split across two chunks", () => {
    const frame = encodeFrame({ edge: "header-split" });

    const decoder = new FrameDecoder();
    expect(decoder.feed(frame.subarray(0, 2))).toHaveLength(0);
    const msgs = decoder.feed(frame.subarray(2));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ edge: "header-split" });
  });

  test("handles large payloads", () => {
    const payload = { data: "x".repeat(100_000) };
    const frame = encodeFrame(payload);
    const decoder = new FrameDecoder();
    const msgs = decoder.feed(frame);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual(payload);
  });

  test("reset clears internal buffer", () => {
    const frame = encodeFrame({ ok: true });
    const half = frame.subarray(0, Math.floor(frame.length / 2));

    const decoder = new FrameDecoder();
    decoder.feed(half);
    decoder.reset();

    const msgs = decoder.feed(frame);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ ok: true });
  });

  test("frame length prefix is correct", () => {
    const payload = { test: 123 };
    const json = JSON.stringify(payload);
    const frame = encodeFrame(payload);

    const length = frame.readUInt32BE(0);
    expect(length).toBe(json.length);
    expect(frame.length).toBe(4 + json.length);
  });
});

// ─── Server + Client Integration ────────────────────────────────────────────

describe("Server + Client", () => {
  const PORT = 4056;
  let client: TcpRpcClient;

  beforeAll(async () => {
    makeServer(PORT).listen();
    client = new TcpRpcClient({ host: "127.0.0.1", port: PORT });
    await client.connect();
  });

  afterAll(() => {
    client.destroy();
  });

  test("basic call: add", async () => {
    const result = await client.call<number>("add", [3, 7]);
    expect(result).toBe(10);
  });

  test("basic call: echo string", async () => {
    const result = await client.call<string>("echo", "ping");
    expect(result).toBe("ping");
  });

  test("echo preserves object shape", async () => {
    const payload = { ticker: "BTC", price: 99_000, tags: ["crypto", "top"] };
    const result = await client.call<typeof payload>("identity", payload);
    expect(result).toEqual(payload);
  });

  test("echo preserves array", async () => {
    const payload = [1, "two", { three: 3 }] as const;
    const result = await client.call<typeof payload>("identity", payload);
    expect(result).toEqual(payload);
  });

  test("echo preserves null", async () => {
    const result = await client.call<null>("identity", null);
    expect(result).toBeNull();
  });

  test("handler error propagates as rejection", async () => {
    await expectRejection(client.call("fail"), "intentional handler error");
  });

  test("unknown method returns error", async () => {
    await expectRejection(
      client.call("doesNotExist"),
      "Unknown method: doesNotExist",
    );
  });

  test("concurrent calls all resolve correctly", async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      client.call<number>("add", [i, i]),
    );
    const results = await Promise.all(calls);
    results.forEach((res, i) => expect(res).toBe(i + i));
  });

  test("concurrent calls with mixed methods", async () => {
    const [sum, echo, identity] = await Promise.all([
      client.call<number>("add", [100, 200]),
      client.call<string>("echo", "mixed"),
      client.call<{ x: number }>("identity", { x: 42 }),
    ]);
    expect(sum).toBe(300);
    expect(echo).toBe("mixed");
    expect(identity).toEqual({ x: 42 });
  });

  test("call times out when handler exceeds timeout", async () => {
    await expectRejection(client.call("delay", { ms: 500 }, 100), /timed out/);
  });

  test("subsequent calls succeed after a timeout", async () => {
    await sleep(600); // let the slow handler finish on the server side
    const result = await client.call<string>("echo", "still alive");
    expect(result).toBe("still alive");
  });

  test("multiple sequential calls maintain correct order", async () => {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await client.call<number>("add", [i, 1]));
    }
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });
});

// ─── Client: connect via registry ───────────────────────────────────────────

describe("Client: registry shorthand", () => {
  test("resolves host and port from registry", () => {
    const client = new TcpRpcClient("telegram");
    // @ts-expect-error accessing private for assertion
    expect(client.options.port).toBe(4000);
    // @ts-expect-error accessing private for assertion
    expect(client.options.host).toBe("localhost");
  });
});

// ─── Client: error states ───────────────────────────────────────────────────

describe("Client: error states", () => {
  test("call before connect rejects", async () => {
    const client = new TcpRpcClient({ host: "127.0.0.1", port: 4056 });
    await expectRejection(client.call("echo", "x"), "[tcp-rpc] not connected");
  });

  test("connect to non-existent server rejects", async () => {
    const client = new TcpRpcClient({
      host: "127.0.0.1",
      port: 19999,
      reconnectDelay: 100,
      maxReconnectDelay: 100,
    });
    try {
      await client.connect();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  test("destroy rejects all pending calls", async () => {
    const PORT = 4057;
    makeServer(PORT).listen();
    const client = new TcpRpcClient({ host: "127.0.0.1", port: PORT });
    await client.connect();

    const pending = client.call("delay", { ms: 2000 });
    client.destroy();

    await expectRejection(pending, "Client destroyed");
  });
});
