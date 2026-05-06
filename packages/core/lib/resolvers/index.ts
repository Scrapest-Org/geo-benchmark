import { type Message } from "discord.js";
import { Api } from "telegram";

type SourceType = "x" | "discord" | "telegram";
type ExtendedSourceType = SourceType | "fast-x";

type TelegramMessage = Api.Message & {
  channelId: string;
};

type PayloadType =
  | ResolvedXPost
  | Message
  | XPostNotification
  | TelegramMessage;

class SourceEvent {
  mid: string | number;
  sid: string | number;
  source: ExtendedSourceType;

  timestamp: number;
  payload: PayloadType;

  constructor(src: ExtendedSourceType, payload: PayloadType, rcv?: number) {
    this.source = src;
    this.mid = payload.id;
    this.sid = "lang" in payload ? payload.author.id : payload.channelId;

    this.timestamp = rcv ?? Date.now();
    this.payload = payload;
  }
}

export { SourceEvent };
export type { SourceType, ExtendedSourceType, PayloadType };
export default SourceEvent;
