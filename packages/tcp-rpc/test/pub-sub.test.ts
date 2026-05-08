import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TcpRpcServer } from "@scrapest/tcp-rpc/src/server";
import { TcpRpcClient } from "@scrapest/tcp-rpc/src/client";

const PORT = 19999;

describe("Server-pushed events", () => {
  let server: TcpRpcServer;
  let client: TcpRpcClient;

  beforeAll(async () => {
    server = new TcpRpcServer({ port: PORT });
    server.listen();
    client = new TcpRpcClient({ host: "127.0.0.1", port: PORT });
    await client.connect();
  });

  afterAll(() => {
    client.destroy();
    server.stop();
  });

  it("delivers broadcast to a subscribed client", async () => {
    const received = new Promise<unknown>((resolve) => {
      client.on("test:event", resolve);
    });

    server.broadcast("test:event", { hello: "world" });

    const data = await received;
    expect(data).toEqual({ hello: "world" });
  });

  it("delivers multiple events", async () => {
    const results: unknown[] = [];
    const handler = (data: unknown) => results.push(data);

    client.on("multi", handler);

    server.broadcast("multi", 1);
    server.broadcast("multi", 2);
    server.broadcast("multi", 3);

    await Bun.sleep(50);
    expect(results).toEqual([1, 2, 3]);

    client.off("multi", handler);
  });

  it("stops delivery after off()", async () => {
    let callCount = 0;
    const handler = () => { callCount++; };

    client.on("off:test", handler);
    server.broadcast("off:test", "first");
    await Bun.sleep(20);
    expect(callCount).toBe(1);

    client.off("off:test", handler);
    server.broadcast("off:test", "second");
    await Bun.sleep(20);
    expect(callCount).toBe(1);
  });

  it("broadcastTo sends only to the targeted socket", async () => {
    const client2 = new TcpRpcClient({ host: "127.0.0.1", port: PORT });
    await client2.connect();

    const received1 = new Promise<unknown>((resolve) => {
      client.on("targeted", resolve);
    });
    let received2 = false;
    client2.on("targeted", () => { received2 = true; });

    const serverAny = server as any;
    const [targetSocket] = [...serverAny.sockets].filter(
      (s: any) => s !== client2,
    );
    server.broadcastTo(targetSocket || [...serverAny.sockets][0], "targeted", { only: "me" });

    await received1;
    expect(received2).toBe(false);

    client2.destroy();
  });

  it("broadcast is no-op when no sockets connected", () => {
    const isolated = new TcpRpcServer({ port: 19998 });
    isolated.listen();
    expect(() => isolated.broadcast("noop", {})).not.toThrow();
    isolated.stop();
  });

  it("does not interfere with existing RPC calls", async () => {
    server.handle("ping", async () => "pong");

    const result = await client.call("ping");
    expect(result).toBe("pong");
  });
});
