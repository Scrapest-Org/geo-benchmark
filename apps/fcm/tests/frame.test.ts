import { describe, expect, test } from "bun:test";
import { MCS_VERSION, McsCodec, Tag, encodeVarint } from "../src/mcs/frame.ts";

describe("McsCodec.encode", () => {
  test("fresh codec first frame prepends version byte", () => {
    const c = McsCodec.fresh();
    const out = c.encode({ tag: Tag.LoginRequest, payload: new TextEncoder().encode("hi") });
    expect(Array.from(out)).toEqual([MCS_VERSION, 2, 2, 0x68, 0x69]);
  });

  test("fresh codec subsequent frame omits version byte", () => {
    const c = McsCodec.fresh();
    c.encode({ tag: 2, payload: new TextEncoder().encode("a") });
    const second = c.encode({ tag: 7, payload: new TextEncoder().encode("bb") });
    expect(Array.from(second)).toEqual([7, 2, 0x62, 0x62]);
  });

  test("post-handshake codec never emits version byte", () => {
    const c = McsCodec.postHandshake();
    const out = c.encode({ tag: 3, payload: new TextEncoder().encode("x") });
    expect(Array.from(out)).toEqual([3, 1, 0x78]);
  });

  test("encode handles multi-byte varint length", () => {
    const c = McsCodec.fresh();
    const payload = new Uint8Array(300);
    const out = c.encode({ tag: 8, payload });
    expect(out[0]).toBe(MCS_VERSION);
    expect(out[1]).toBe(8);
    expect(out[2]).toBe(0xac);
    expect(out[3]).toBe(0x02);
    expect(out.length).toBe(4 + 300);
  });
});

describe("McsCodec.feed", () => {
  test("fresh codec consumes leading version byte then frame", () => {
    const c = McsCodec.fresh();
    const buf = new Uint8Array([MCS_VERSION, 3, 4, 0x61, 0x62, 0x63, 0x64]);
    const frames = c.feed(buf);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.tag).toBe(3);
    expect(Array.from(frames[0]!.payload)).toEqual([0x61, 0x62, 0x63, 0x64]);
  });

  test("fresh codec rejects wrong leading byte", () => {
    const c = McsCodec.fresh();
    expect(() => c.feed(new Uint8Array([42, 3, 1, 0x78]))).toThrow();
  });

  test("post-handshake returns empty for empty input", () => {
    const c = McsCodec.postHandshake();
    expect(c.feed(new Uint8Array([]))).toEqual([]);
  });

  test("post-handshake returns empty when payload is partial", () => {
    const c = McsCodec.postHandshake();
    const partial = new Uint8Array([3, 5, 0x68, 0x65]);
    expect(c.feed(partial)).toEqual([]);
    // Subsequent feed completes it
    const rest = c.feed(new Uint8Array([0x6c, 0x6c, 0x6f]));
    expect(rest).toHaveLength(1);
    expect(rest[0]!.tag).toBe(3);
    expect(Array.from(rest[0]!.payload)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  test("post-handshake decodes two back-to-back frames", () => {
    const c = McsCodec.postHandshake();
    const frames = c.feed(new Uint8Array([1, 1, 0x58, 8, 2, 0x79, 0x7a]));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.tag).toBe(1);
    expect(frames[1]!.tag).toBe(8);
    expect(Array.from(frames[1]!.payload)).toEqual([0x79, 0x7a]);
  });

  test("encode → feed round-trip across realistic sizes", () => {
    for (const size of [0, 1, 16, 127, 128, 16383, 16384, 65535]) {
      const enc = McsCodec.fresh();
      const dec = McsCodec.fresh();
      const payload = new Uint8Array(size);
      for (let i = 0; i < size; i++) payload[i] = i & 0xff;
      const wire = enc.encode({ tag: 8, payload });
      const frames = dec.feed(wire);
      expect(frames).toHaveLength(1);
      expect(frames[0]!.tag).toBe(8);
      expect(Array.from(frames[0]!.payload)).toEqual(Array.from(payload));
    }
  });
});

describe("varint encoding matches protobuf", () => {
  test.each<[number, number[]]>([
    [0, [0]],
    [1, [1]],
    [127, [127]],
    [128, [0x80, 0x01]],
    [300, [0xac, 0x02]],
    [16383, [0xff, 0x7f]],
    [16384, [0x80, 0x80, 0x01]],
  ])("encodeVarint(%i)", (val, expected) => {
    expect(Array.from(encodeVarint(val))).toEqual(expected);
  });
});
