import { randomUUID } from "crypto";
import { encodeFrame, FrameDecoder } from "./framing";
import { RPC_REGISTRY, type RpcServiceName } from "./registry";

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RECONNECT_DELAY = 500;
const DEFAULT_MAX_RECONNECT_DELAY = 16_000;

export class TcpRpcClient {
  private options: Required<TcpRpcClientOptions>;
  private socket: BunSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private decoder = new FrameDecoder();
  private reconnectAttempt = 0;
  private destroyed = false;
  private connectPromise: Promise<void> | null = null;

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
            self.reconnectAttempt = 0;
            self.decoder.reset();
            console.log(`[tcp-rpc] connected to ${host}:${port}`);
            resolve();
          },

          data(_socket, chunk) {
            const messages = self.decoder.feed(Buffer.from(chunk));
            for (const message of messages) {
              self._handleResponse(message as RpcResponse);
            }
          },

          close() {
            self.socket = null;
            console.warn(`[tcp-rpc] connection closed`);
            self._rejectAllPending(new Error("Connection closed"));
            if (!self.destroyed) self._scheduleReconnect();
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

      this.socket!.write(encodeFrame({ id, method, params }));
    });
  }

  destroy() {
    this.destroyed = true;
    this._rejectAllPending(new Error("Client destroyed"));
    this.socket?.end();
  }
}
