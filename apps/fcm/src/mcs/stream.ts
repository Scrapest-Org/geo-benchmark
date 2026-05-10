// Drive an MCS connection with the same delivery semantics as Chromium's
// MCSClient (and the Rust port in src/mcs/stream.rs):
//
//  1. RMQ2 stream-id tracking on every outbound after LoginRequest.
//  2. Self-initiated HeartbeatPing on the server-suggested cadence; reconnect
//     if no HeartbeatAck arrives within the deadline.
//  3. StreamAck IQ once `last_stream_id_received - acked >= 10`.
//  4. SelectiveAck IQ per inbound DataMessageStanza so the server stops
//     redelivering once we've durably handled it.
//  5. On a malformed DataMessageStanza, dump the raw bytes, ack via a scraped
//     persistent_id, skip — *don't* tear the connection down.

import type { Duplex } from "node:stream";
import {
  type DataMessageStanza,
  DataMessageStanza as DMS,
  Extension,
  HeartbeatAck,
  HeartbeatPing,
  IqStanza,
  IqStanza_IqType,
  LoginRequest,
  LoginResponse,
  SelectiveAck as SelectiveAckMsg,
} from "../../gen/mcs.ts";
import { McsCodec, type McsFrame, Tag } from "./frame.ts";
import {
  SELECTIVE_ACK_EXTENSION_ID,
  STREAM_ACK_EXTENSION_ID,
  buildLoginRequest,
} from "./login.ts";

export const MAX_STREAM_IDS_BEFORE_ACK = 10;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
export const MIN_HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_DEADLINE_MS = 30_000;

export interface InboundDataMessage {
  persistentId: string;
  rawData: Uint8Array;
  headers: Record<string, string>;
}

/** Async queue of decoded frames with optional timeout on take(). */
class FrameQueue {
  private queue: McsFrame[] = [];
  private waiter: ((value: { frame: McsFrame | null; timedOut: boolean }) => void) | null = null;
  private waiterTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private err: Error | null = null;

  push(frame: McsFrame): void {
    if (this.waiter) {
      this.fulfill({ frame, timedOut: false });
    } else {
      this.queue.push(frame);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) this.fulfill({ frame: null, timedOut: false });
  }

  fail(err: Error): void {
    this.err = err;
    if (this.waiter) this.fulfill({ frame: null, timedOut: false });
  }

  /** Take the next frame; if `timeoutMs` elapses first, returns `timedOut: true`. */
  async take(timeoutMs: number): Promise<{ frame: McsFrame | null; timedOut: boolean }> {
    if (this.err) throw this.err;
    if (this.queue.length > 0) return { frame: this.queue.shift()!, timedOut: false };
    if (this.closed) return { frame: null, timedOut: false };

    return new Promise((resolve) => {
      this.waiter = resolve;
      this.waiterTimer = setTimeout(() => this.fulfill({ frame: null, timedOut: true }), timeoutMs);
    });
  }

  private fulfill(value: { frame: McsFrame | null; timedOut: boolean }): void {
    const w = this.waiter;
    const t = this.waiterTimer;
    this.waiter = null;
    this.waiterTimer = null;
    if (t) clearTimeout(t);
    if (w) w(value);
  }
}

export class Session {
  private codec = McsCodec.fresh();
  private streamIdOut = 1; // LoginRequest counts as our outbound #1
  private lastStreamIdReceived = 0;
  private lastStreamIdReceivedAcked = 0;
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
  private nextHeartbeatAt = Date.now() + DEFAULT_HEARTBEAT_INTERVAL_MS;
  private heartbeatOutstanding: number | null = null;
  private iqCounter = 0;
  private frames = new FrameQueue();

  private constructor(
    private readonly socket: Duplex,
    private readonly logger: Logger,
  ) {}

  /** Send LoginRequest, await LoginResponse, return ready Session. */
  static async login(
    socket: Duplex,
    androidId: bigint,
    securityToken: bigint,
    receivedPersistentIds: string[],
    logger: Logger = nullLogger,
  ): Promise<Session> {
    const s = new Session(socket, logger);
    s.attachSocket();
    s.write(
      s.codec.encode({
        tag: Tag.LoginRequest,
        payload: encodeLoginRequest(androidId, securityToken, receivedPersistentIds),
      }),
    );
    s.logger.debug("LoginRequest flushed; awaiting LoginResponse");

    while (true) {
      const { frame, timedOut } = await s.frames.take(60_000);
      if (timedOut) throw new Error("timed out waiting for LoginResponse");
      if (frame === null) throw new Error("MCS closed before LoginResponse");

      s.lastStreamIdReceived += 1;
      s.logger.debug("MCS frame received", { tag: frame.tag, len: frame.payload.length });

      if (frame.tag === Tag.LoginResponse) {
        const resp = LoginResponse.decode(frame.payload);
        if (resp.error) {
          throw new Error(
            `MCS LoginResponse error: code=${resp.error.code} message=${resp.error.message ?? ""}`,
          );
        }
        const proposed = resp.heartbeatConfig?.intervalMs;
        if (typeof proposed === "number" && proposed > 0) {
          s.heartbeatIntervalMs = Math.max(proposed, MIN_HEARTBEAT_INTERVAL_MS);
        }
        s.nextHeartbeatAt = Date.now() + s.heartbeatIntervalMs;
        s.logger.info("MCS login complete", { heartbeatIntervalMs: s.heartbeatIntervalMs });
        return s;
      }
      if (frame.tag === Tag.Close) {
        throw new Error("MCS sent Close before LoginResponse");
      }
      // Skip any other pre-login frames silently.
    }
  }

  /** Pump frames until the next DataMessageStanza arrives. Heartbeats and
   *  stream/selective acks are sent transparently. */
  async nextData(): Promise<InboundDataMessage | null> {
    for (;;) {
      // Catch up on stream-ack accounting before reading more.
      if (
        this.lastStreamIdReceived - this.lastStreamIdReceivedAcked >=
        MAX_STREAM_IDS_BEFORE_ACK
      ) {
        await this.sendStreamAck();
      }

      // Compute current timeout: until next-heartbeat (if no ack outstanding)
      // or until heartbeat deadline (if waiting on ack).
      const now = Date.now();
      let timeoutMs: number;
      let pendingDeadline: "send-heartbeat" | "heartbeat-timeout";
      if (this.heartbeatOutstanding === null) {
        timeoutMs = Math.max(1, this.nextHeartbeatAt - now);
        pendingDeadline = "send-heartbeat";
      } else {
        timeoutMs = Math.max(1, this.heartbeatOutstanding + HEARTBEAT_DEADLINE_MS - now);
        pendingDeadline = "heartbeat-timeout";
      }

      const { frame, timedOut } = await this.frames.take(timeoutMs);
      if (timedOut) {
        if (pendingDeadline === "send-heartbeat") {
          this.logger.debug("heartbeat interval reached; sending HeartbeatPing");
          await this.sendHeartbeatPing();
          this.heartbeatOutstanding = Date.now();
        } else {
          throw new Error("MCS heartbeat ack not received within deadline");
        }
        continue;
      }
      if (frame === null) return null;

      this.lastStreamIdReceived += 1;
      const result = await this.dispatch(frame);
      if (result !== undefined) return result;
    }
  }

  private async dispatch(frame: McsFrame): Promise<InboundDataMessage | undefined> {
    this.logger.debug("MCS frame received", {
      tag: frame.tag,
      len: frame.payload.length,
      lastRecv: this.lastStreamIdReceived,
    });
    switch (frame.tag) {
      case Tag.HeartbeatPing: {
        const ping = HeartbeatPing.decode(frame.payload);
        await this.sendHeartbeatAck(ping.status ?? undefined);
        return undefined;
      }
      case Tag.HeartbeatAck: {
        this.heartbeatOutstanding = null;
        this.nextHeartbeatAt = Date.now() + this.heartbeatIntervalMs;
        return undefined;
      }
      case Tag.DataMessageStanza:
        return await this.handleDataMessage(frame);
      case Tag.Close:
        this.frames.close();
        return undefined;
      case Tag.IqStanza: {
        try {
          const iq = IqStanza.decode(frame.payload);
          this.logger.debug("MCS IqStanza received", {
            type: iq.type,
            id: iq.id,
            extId: iq.extension?.id,
            extLen: iq.extension?.data?.length ?? 0,
            streamId: iq.streamId,
            lastStreamIdReceived: iq.lastStreamIdReceived,
          });
        } catch (err) {
          this.logger.debug("malformed IqStanza, ignoring", { err: String(err) });
        }
        return undefined;
      }
      default:
        this.logger.warn("unknown MCS frame tag", { tag: frame.tag });
        return undefined;
    }
  }

  private async handleDataMessage(frame: McsFrame): Promise<InboundDataMessage | undefined> {
    let dms: DataMessageStanza;
    try {
      dms = DMS.decode(frame.payload);
    } catch (err) {
      // Don't tear the session down — that just causes the server to redeliver
      // the same bad bytes forever. Try to scrape the persistent_id and ack
      // anyway so we break the loop.
      this.logger.error("DataMessageStanza decode failed; skipping", {
        err: String(err),
        len: frame.payload.length,
      });
      const pid = scrapePersistentId(frame.payload);
      if (pid) await this.sendSelectiveAck([pid]);
      return undefined;
    }
    if (!dms.persistentId) {
      this.logger.warn("DataMessageStanza without persistent_id — skipping");
      return undefined;
    }
    const headers: Record<string, string> = {};
    for (const kv of dms.appData ?? []) {
      if (kv.key && kv.value !== undefined) headers[kv.key] = kv.value;
    }
    await this.sendSelectiveAck([dms.persistentId]);
    return {
      persistentId: dms.persistentId,
      rawData: dms.rawData ?? new Uint8Array(),
      headers,
    };
  }

  private async sendHeartbeatPing(): Promise<void> {
    this.streamIdOut += 1;
    const msg: HeartbeatPing = {
      streamId: this.streamIdOut,
      lastStreamIdReceived: this.lastStreamIdReceived,
    };
    this.lastStreamIdReceivedAcked = this.lastStreamIdReceived;
    this.write(this.codec.encode({ tag: Tag.HeartbeatPing, payload: HeartbeatPing.encode(msg).finish() }));
  }

  private async sendHeartbeatAck(status?: string): Promise<void> {
    this.streamIdOut += 1;
    const msg: HeartbeatAck = {
      streamId: this.streamIdOut,
      lastStreamIdReceived: this.lastStreamIdReceived,
      status,
    };
    this.lastStreamIdReceivedAcked = this.lastStreamIdReceived;
    this.write(this.codec.encode({ tag: Tag.HeartbeatAck, payload: HeartbeatAck.encode(msg).finish() }));
  }

  private async sendSelectiveAck(ids: string[]): Promise<void> {
    this.iqCounter += 1;
    this.streamIdOut += 1;
    const inner = SelectiveAckMsg.encode({ id: ids }).finish();
    const ext: Extension = { id: SELECTIVE_ACK_EXTENSION_ID, data: inner };
    const iq: IqStanza = {
      type: IqStanza_IqType.SET,
      id: String(this.iqCounter),
      extension: ext,
      streamId: this.streamIdOut,
      lastStreamIdReceived: this.lastStreamIdReceived,
    } as IqStanza;
    this.lastStreamIdReceivedAcked = this.lastStreamIdReceived;
    this.write(this.codec.encode({ tag: Tag.IqStanza, payload: IqStanza.encode(iq).finish() }));
  }

  private async sendStreamAck(): Promise<void> {
    this.iqCounter += 1;
    this.streamIdOut += 1;
    const ext: Extension = { id: STREAM_ACK_EXTENSION_ID, data: new Uint8Array() };
    const iq: IqStanza = {
      type: IqStanza_IqType.SET,
      id: String(this.iqCounter),
      extension: ext,
      streamId: this.streamIdOut,
      lastStreamIdReceived: this.lastStreamIdReceived,
    } as IqStanza;
    this.lastStreamIdReceivedAcked = this.lastStreamIdReceived;
    this.write(this.codec.encode({ tag: Tag.IqStanza, payload: IqStanza.encode(iq).finish() }));
  }

  private write(buf: Uint8Array): void {
    if (!this.socket.writable) return;
    this.socket.write(Buffer.from(buf));
  }

  private attachSocket(): void {
    this.socket.on("data", (chunk: Buffer) => {
      try {
        const frames = this.codec.feed(new Uint8Array(chunk));
        for (const f of frames) this.frames.push(f);
      } catch (err) {
        this.frames.fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
    this.socket.on("end", () => this.frames.close());
    this.socket.on("close", () => this.frames.close());
    this.socket.on("error", (err: Error) => this.frames.fail(err));
  }
}

function encodeLoginRequest(
  androidId: bigint,
  securityToken: bigint,
  persistentIds: string[],
): Uint8Array {
  const req = buildLoginRequest(androidId, securityToken, persistentIds);
  return LoginRequest.encode(req).finish();
}

/** Best-effort scrape of `DataMessageStanza.persistent_id` (field 9, wire
 *  type 2 = length-delimited) from a raw protobuf-encoded message. Used only
 *  when prost-style decode fails so we can still ack and break redelivery. */
export function scrapePersistentId(buf: Uint8Array): string | null {
  let i = 0;
  while (i < buf.length) {
    const v = readVarint(buf, i);
    if (v === null) return null;
    i = v.next;
    const field = v.value >>> 3;
    const wire = v.value & 7;
    switch (wire) {
      case 0: {
        const v2 = readVarint(buf, i);
        if (v2 === null) return null;
        i = v2.next;
        break;
      }
      case 1:
        i += 8;
        break;
      case 5:
        i += 4;
        break;
      case 2: {
        const len = readVarint(buf, i);
        if (len === null) return null;
        i = len.next;
        const end = i + len.value;
        if (end > buf.length) return null;
        if (field === 9) {
          try {
            return new TextDecoder("utf-8", { fatal: true }).decode(buf.slice(i, end));
          } catch {
            return null;
          }
        }
        i = end;
        break;
      }
      default:
        return null;
    }
  }
  return null;
}

function readVarint(buf: Uint8Array, off: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: value >>> 0, next: off + i + 1 };
    shift += 7;
  }
  return null;
}

// ----- logging interface ---------------------------------------------------

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
