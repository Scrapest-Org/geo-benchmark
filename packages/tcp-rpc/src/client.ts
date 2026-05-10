import { randomUUID } from "crypto";
import { encodeFrame, FrameDecoder } from "./framing";
import { RPC_REGISTRY, type RpcServiceName } from "./registry";

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RECONNECT_DELAY = 500;
const DEFAULT_MAX_RECONNECT_DELAY = 16_000;

function writeOrBuffer(socket: any, frame: Buffer): void {
  if (socket._pending) {
    socket._pending = Buffer.concat([socket._pending, frame]);
    return;
  }
  const wrote = socket.write(frame);
  if (wrote < frame.byteLength) {
    socket._pending = frame.subarray(wrote);
  }
}

function flushSocket(socket: any): void {
  const pending = socket._pending as Buffer | null;
  if (!pending) return;
  const wrote = socket.write(pending);
  if (wrote < pending.byteLength) {
    socket._pending = pending.subarray(wrote);
  } else {
    socket._pending = null;
  }
}

export class TcpRpcClient {
  private options: Required<TcpRpcClientOptions>;
  private socket: BunSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private decoder = new FrameDecoder();
  private reconnectAttempt = 0;
  private destroyed = false;
  private connectPromise: Promise<void> | null = null;
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(service: RpcServiceName);
  constructor(options: TcpRpcClientOptions);
  constructor(arg: RpcServiceName | TcpRpcClientOptions) {
    const base = typeof arg === "string" ? RPC_REGISTRY[arg] : arg;
    this.options = {
      timeout: DEFAULT_TIMEOUT,
      reconnectDelay: DEFAULT_RECONNECT_DELAY,
      maxReconnectDelay: DEFAULT_MAX_RECONNECT_DELAY,
      ...base,
    };
  }

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connect();
    return this.connectPromise;
  }

  private async _connect(): Promise<void> {
    const { host, port } = this.options;
    const self = this;

    return new Promise((resolve, reject) => {
      Bun.connect({
        hostname: host,
        port,
        socket: {
          open(socket) {
            self.socket = socket as any;
            (socket as any)._pending = null;
            self.reconnectAttempt = 0;
            self.decoder.reset();
            console.log(`[tcp-rpc] connected to ${host}:${port}`);
            resolve();
          },

          data(_socket, chunk) {
            const messages = self.decoder.feed(Buffer.from(chunk));
            for (const message of messages) {
              if ("event" in message) {
                self._dispatchEvent(message as RpcEvent);
              } else {
                self._handleResponse(message as RpcResponse);
              }
            }
          },

          close() {
            self.socket = null;
            console.warn(`[tcp-rpc] connection closed`);
            self._rejectAllPending(new Error("Connection closed"));
            if (!self.destroyed) self._scheduleReconnect();
          },

          drain(socket) {
            flushSocket(socket);
          },

          error(_socket, err) {
            console.error(`[tcp-rpc] error:`, err.message);
            reject(err);
          },
        },
      }).catch((e) => {
        reject(e);

        if (!self.destroyed) {
          self.connectPromise = null;
          self._scheduleReconnect();
        }
      });
    });
  }

  on(event: string, handler: (data: unknown) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: (data: unknown) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  private _dispatchEvent(message: RpcEvent) {
    const handlers = this.listeners.get(message.event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(message.data);
    }
  }

  private _handleResponse(response: RpcResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  private _rejectAllPending(err: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  private _scheduleReconnect() {
    const { reconnectDelay, maxReconnectDelay } = this.options;
    const delay = Math.min(
      reconnectDelay * 2 ** this.reconnectAttempt,
      maxReconnectDelay,
    );
    this.reconnectAttempt++;
    console.log(
      `[tcp-rpc] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );

    setTimeout(async () => {
      this.connectPromise = null;
      this.decoder.reset();
      try {
        await this.connect();
      } catch {
        // error handler will trigger close → _scheduleReconnect again
      }
    }, delay);
  }

  async call<R = unknown>(
    method: string,
    params?: unknown,
    timeout?: number,
  ): Promise<R> {
    if (!this.socket)
      return Promise.reject(new Error("[tcp-rpc] not connected"));

    const id = randomUUID();
    const ms = timeout ?? this.options.timeout;

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[tcp-rpc] call "${method}" timed out after ${ms}ms`));
      }, ms);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      writeOrBuffer(this.socket!, encodeFrame({ id, method, params }));
    });
  }

  emit(event: string, data?: unknown): void {
    if (!this.socket) return;
    writeOrBuffer(this.socket, encodeFrame({ type: "event", event, data } satisfies RpcEvent));
  }

  destroy() {
    this.destroyed = true;
    this._rejectAllPending(new Error("Client destroyed"));
    this.socket?.end();
  }
}
