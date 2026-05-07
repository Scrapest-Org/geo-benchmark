type SourceType = "x";
type ExtendedSourceType = SourceType | "fast-x";

type PayloadType = ResolvedXPost | XPostNotification;

class SourceEvent {
  mid: string | number;
  sid: string | number;
  source: ExtendedSourceType;
  vmName: string;

  timestamp: number;
  payload: PayloadType;

  constructor(
    src: ExtendedSourceType,
    payload: PayloadType,
    vmName: string,
    rcv?: number,
  ) {
    this.source = src;
    this.mid = payload.id;
    this.sid = payload.author.id;

    this.timestamp = rcv ?? Date.now();
    this.payload = payload;
    this.vmName = vmName;
  }
}

export { SourceEvent };
export type { SourceType, ExtendedSourceType, PayloadType };
export default SourceEvent;
