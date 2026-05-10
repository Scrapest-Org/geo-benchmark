// MCS framing codec.
//
// On the wire, MCS frames are NOT protobuf-delimited messages; the framing is
// hand-rolled bytes:
//
//   first frame from client:   [version=41][tag: u8][len: varint][payload]
//   every other frame:                     [tag: u8][len: varint][payload]
//
// `len` is a LEB128/base-128 varint (identical to protobuf's). The version
// byte appears once per direction (server also sends it on its first frame).

export const MCS_VERSION = 41;

export const Tag = {
  HeartbeatPing: 0,
  HeartbeatAck: 1,
  LoginRequest: 2,
  LoginResponse: 3,
  Close: 4,
  IqStanza: 7,
  DataMessageStanza: 8,
} as const;
export type TagValue = (typeof Tag)[keyof typeof Tag];

export interface McsFrame {
  tag: number;
  payload: Uint8Array;
}

export class McsCodec {
  private pendingVersionByte: boolean;
  private expectingVersionByte: boolean;
  private buffer: Uint8Array = new Uint8Array(0);

  private constructor(initial: boolean) {
    this.pendingVersionByte = initial;
    this.expectingVersionByte = initial;
  }

  /** Fresh connection: emits version byte on first encode, consumes one on
   *  first decode. Used for both client and server sides of a real socket. */
  static fresh(): McsCodec {
    return new McsCodec(true);
  }

  /** Already-handshaked stream: never adds or strips a version byte. Used by
   *  tests that hand-craft post-login frames. */
  static postHandshake(): McsCodec {
    return new McsCodec(false);
  }

  encode(frame: McsFrame): Uint8Array {
    const lenBytes = encodeVarint(frame.payload.length);
    const prefix = this.pendingVersionByte ? 1 : 0;
    const out = new Uint8Array(prefix + 1 + lenBytes.length + frame.payload.length);
    let i = 0;
    if (this.pendingVersionByte) {
      out[i++] = MCS_VERSION;
      this.pendingVersionByte = false;
    }
    out[i++] = frame.tag;
    out.set(lenBytes, i);
    i += lenBytes.length;
    out.set(frame.payload, i);
    return out;
  }

  /** Feed inbound bytes; return any complete frames now decodable. Throws on
   *  malformed framing (wrong version byte, varint > 10 continuation bytes). */
  feed(chunk: Uint8Array): McsFrame[] {
    if (chunk.length > 0) this.buffer = concat(this.buffer, chunk);

    const out: McsFrame[] = [];
    while (true) {
      if (this.expectingVersionByte) {
        if (this.buffer.length === 0) break;
        if (this.buffer[0] !== MCS_VERSION) {
          throw new Error(
            `expected MCS version byte ${MCS_VERSION}, got ${this.buffer[0]}`,
          );
        }
        this.buffer = this.buffer.slice(1);
        this.expectingVersionByte = false;
      }

      if (this.buffer.length === 0) break;
      const tag = this.buffer[0]!;
      const v = tryDecodeVarint(this.buffer, 1);
      if (v === null) break; // need more bytes for varint
      const [payloadLen, varintBytes] = v;
      const total = 1 + varintBytes + payloadLen;
      if (this.buffer.length < total) break;

      const payload = this.buffer.slice(1 + varintBytes, total);
      this.buffer = this.buffer.slice(total);
      out.push({ tag, payload });
    }
    return out;
  }
}

export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0xff);
  return new Uint8Array(bytes);
}

/** Returns [value, bytesConsumed] or null if more bytes are needed. */
function tryDecodeVarint(buf: Uint8Array, offset: number): [number, number] | null {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    const idx = offset + i;
    if (idx >= buf.length) return null;
    const b = buf[idx]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [value >>> 0, i + 1];
    shift += 7;
  }
  throw new Error("varint too long");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
