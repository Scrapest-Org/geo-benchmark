/**
 * Wire format: [4 bytes big-endian length][JSON payload]
 *
 * TCP is a stream — one write() doesn't guarantee one read().
 * The 4-byte header tells the reader exactly how many bytes to
 * accumulate before attempting a JSON parse.
 */

export function encodeFrame(payload: object): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.alloc(4 + json.length);
  frame.writeUInt32BE(json.length, 0);
  json.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): object[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: object[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);

      // not enough bytes yet — wait for more chunks
      if (this.buffer.length < 4 + length) break;

      const payload = this.buffer.subarray(4, 4 + length);
      messages.push(JSON.parse(payload.toString("utf8")));
      this.buffer = this.buffer.subarray(4 + length);
    }

    return messages;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}
