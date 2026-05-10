import { afterEach, describe, expect, test } from "bun:test";
import { Duplex, PassThrough } from "node:stream";
import {
  AppData,
  DataMessageStanza,
  ErrorInfo,
  HeartbeatAck,
  HeartbeatPing,
  IqStanza,
  IqStanza_IqType,
  LoginRequest,
  LoginResponse,
  SelectiveAck,
} from "../gen/mcs.ts";
import { McsCodec, type McsFrame, Tag } from "../src/mcs/frame.ts";
import { SELECTIVE_ACK_EXTENSION_ID } from "../src/mcs/login.ts";
import { Session } from "../src/mcs/stream.ts";

/** A pair of Duplex streams wired so writes on one end appear as reads on
 *  the other. Both ends are full Duplex with .write() / "data" / "end". */
function duplexPair(): [Duplex, Duplex] {
  const ab = new PassThrough();
  const ba = new PassThrough();
  // Duplex.from returns a Duplex view over a (readable, writable) pair.
  const a = Duplex.from({ readable: ba, writable: ab });
  const b = Duplex.from({ readable: ab, writable: ba });
  return [a, b];
}

/** Wait for the server-side to receive its next inbound frame. */
function readNextFrame(server: Duplex, codec: McsCodec): Promise<McsFrame> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      try {
        const frames = codec.feed(new Uint8Array(chunk));
        if (frames.length > 0) {
          server.off("data", onData);
          server.off("error", reject);
          resolve(frames[0]!);
        }
      } catch (e) {
        reject(e as Error);
      }
    };
    server.on("data", onData);
    server.on("error", reject);
  });
}

describe("Session", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
  });

  test("login handshake succeeds with LoginResponse", async () => {
    const [client, server] = duplexPair();
    cleanup.push(() => {
      client.destroy();
      server.destroy();
    });
    const serverCodec = McsCodec.fresh();

    const serverWork = (async () => {
      const req = await readNextFrame(server, serverCodec);
      expect(req.tag).toBe(Tag.LoginRequest);
      const decoded = LoginRequest.decode(req.payload);
      expect(decoded.user).toBe("1");
      expect(decoded.authToken).toBe("2");

      const resp = LoginResponse.encode({ id: decoded.id ?? "", setting: [] } as LoginResponse).finish();
      const wire = serverCodec.encode({ tag: Tag.LoginResponse, payload: resp });
      server.write(Buffer.from(wire));
    })();

    const session = await Session.login(client, 1n, 2n, []);
    await serverWork;
    expect(session).toBeDefined();
  });

  test("login propagates error response", async () => {
    const [client, server] = duplexPair();
    cleanup.push(() => {
      client.destroy();
      server.destroy();
    });
    const serverCodec = McsCodec.fresh();

    void (async () => {
      await readNextFrame(server, serverCodec);
      const err: ErrorInfo = { code: 401, message: "bad creds" };
      const resp = LoginResponse.encode({ id: "x", error: err, setting: [] } as LoginResponse).finish();
      server.write(Buffer.from(serverCodec.encode({ tag: Tag.LoginResponse, payload: resp })));
    })();

    await expect(Session.login(client, 1n, 2n, [])).rejects.toThrow(/LoginResponse error/);
  });

  test("responds to HeartbeatPing with HeartbeatAck (RMQ2 fields set)", async () => {
    const [client, server] = duplexPair();
    cleanup.push(() => {
      client.destroy();
      server.destroy();
    });
    const serverCodec = McsCodec.fresh();

    const serverWork = (async () => {
      // Read login req, send login resp.
      await readNextFrame(server, serverCodec);
      const resp = LoginResponse.encode({ id: "x", setting: [] } as LoginResponse).finish();
      server.write(Buffer.from(serverCodec.encode({ tag: Tag.LoginResponse, payload: resp })));

      // Send a heartbeat ping with stream_id=7.
      const ping = HeartbeatPing.encode({ streamId: 7 } as HeartbeatPing).finish();
      server.write(Buffer.from(serverCodec.encode({ tag: Tag.HeartbeatPing, payload: ping })));

      // Expect a HeartbeatAck with our outbound stream_id=2 and last_recv=2.
      const ackFrame = await readNextFrame(server, serverCodec);
      expect(ackFrame.tag).toBe(Tag.HeartbeatAck);
      const ack = HeartbeatAck.decode(ackFrame.payload);
      expect(ack.streamId).toBe(2);
      expect(ack.lastStreamIdReceived).toBe(2);
    })();

    const session = await Session.login(client, 1n, 2n, []);
    // Start nextData() so the heartbeat-ping branch runs and sends the ack.
    const nextDataPromise = session.nextData();
    // Race against a small timeout since nextData blocks indefinitely.
    const result = await Promise.race([
      nextDataPromise,
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1000)),
    ]);
    expect(result === "timeout" || result === null).toBeTruthy();
    await serverWork;
  });

  test("surfaces DataMessageStanza and sends SelectiveAck with RMQ2 fields", async () => {
    const [client, server] = duplexPair();
    cleanup.push(() => {
      client.destroy();
      server.destroy();
    });
    const serverCodec = McsCodec.fresh();

    const serverWork = (async () => {
      await readNextFrame(server, serverCodec);
      const resp = LoginResponse.encode({ id: "x", setting: [] } as LoginResponse).finish();
      server.write(Buffer.from(serverCodec.encode({ tag: Tag.LoginResponse, payload: resp })));

      const dms: DataMessageStanza = {
        from: "fcm",
        category: "wp",
        persistentId: "0:1700000000000",
        rawData: new Uint8Array([0, 1, 2, 0xab, 0xcd, 0xef, 3]),
        appData: [{ key: "content-encoding", value: "aes128gcm" } as AppData],
        clientEventStat: [],
      } as unknown as DataMessageStanza;
      const dmsBytes = DataMessageStanza.encode(dms).finish();
      server.write(Buffer.from(serverCodec.encode({ tag: Tag.DataMessageStanza, payload: dmsBytes })));

      const ackFrame = await readNextFrame(server, serverCodec);
      expect(ackFrame.tag).toBe(Tag.IqStanza);
      const iq = IqStanza.decode(ackFrame.payload);
      expect(iq.type).toBe(IqStanza_IqType.SET);
      expect(iq.streamId).toBe(2);
      expect(iq.lastStreamIdReceived).toBe(2);
      expect(iq.extension!.id).toBe(SELECTIVE_ACK_EXTENSION_ID);
      const inner = SelectiveAck.decode(iq.extension!.data!);
      expect(inner.id).toEqual(["0:1700000000000"]);
    })();

    const session = await Session.login(client, 1n, 2n, []);
    const msg = await session.nextData();
    expect(msg).not.toBeNull();
    expect(msg!.persistentId).toBe("0:1700000000000");
    expect(msg!.headers["content-encoding"]).toBe("aes128gcm");
    await serverWork;
  });
});
