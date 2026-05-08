import { describe, test, expect } from "bun:test";
import { RPC_REGISTRY } from "@scrapest/tcp-rpc/src/registry";
import { encodeFrame, FrameDecoder } from "@scrapest/tcp-rpc/src/framing";
import { TcpRpcServer } from "@scrapest/tcp-rpc/src/server";
import { TcpRpcClient } from "@scrapest/tcp-rpc/src/client";

describe("TCP RPC Package Tests", () => {
  test("RPC_REGISTRY contains known services", () => {
    expect(RPC_REGISTRY.telegram).toBeDefined();
    expect(RPC_REGISTRY.telegram.port).toBe(4000);
  });

  test("framing encode and decode", () => {
    const payload = { text: "hello world" };
    const frame = encodeFrame(payload);

    const decoder = new FrameDecoder();
    const msgs = decoder.feed(frame);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual(payload);
  });

  test("full server-client call", async () => {
    const port = 4055;
    const server = new TcpRpcServer({ port });
    server.handle("add", async (params: any) => params[0] + params[1]);
    server.handle("echo", async (msg: any) => msg);

    server.listen();

    const client = new TcpRpcClient({ host: "127.0.0.1", port, maxReconnectDelay: 0 });
    await client.connect();

    const sum = await client.call("add", [10, 20]);
    expect(sum).toBe(30);

    const msg = await client.call("echo", "hello from client");
    expect(msg).toBe("hello from client");

    client.destroy();
  });
});
