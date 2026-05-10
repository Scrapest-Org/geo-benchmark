import { encodeFrame, FrameDecoder } from "./framing";

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

export class TcpRpcServer {
  private handlers = new Map<string, RpcHandler>();
  private eventListeners = new Map<string, Set<(data: unknown, socket: any) => void>>();
  private options: Required<TcpRpcServerOptions>;
  private server: { stop: (force?: boolean) => void } | null = null;
  private sockets = new Set<any>();

  constructor(options: TcpRpcServerOptions) {
    this.options = {
      host: "0.0.0.0",
      ...options,
    };
  }

  on(event: string, handler: (data: unknown, socket: any) => void): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: (data: unknown, socket: any) => void): this {
    this.eventListeners.get(event)?.delete(handler);
    return this;
  }

  handle<P = unknown, R = unknown>(method: string, handler: RpcHandler<P, R>) {
    this.handlers.set(method, handler as RpcHandler);
    return this;
  }

  listen() {
    const { port, host } = this.options;
    const handlers = this.handlers;
    const self = this;

    this.server = Bun.listen({
      hostname: host,
      port,
      socket: {
        open(socket) {
          (socket as any)._decoder = new FrameDecoder();
          (socket as any)._pending = null;
          self.sockets.add(socket);
          console.log(`[tcp-rpc] client connected`);
        },

        async data(socket, chunk) {
          const decoder: FrameDecoder = (socket as any)._decoder;
          const messages = decoder.feed(Buffer.from(chunk));

          for (const message of messages) {
            if ("event" in message) {
              const ev = message as RpcEvent;
              self._dispatchEvent(ev.event, ev.data, socket);
              continue;
            }
            const req = message as RpcRequest;
            const response: RpcResponse = { id: req.id };

            const handler = handlers.get(req.method);

            if (!handler) {
              response.error = `Unknown method: ${req.method}`;
            } else {
              try {
                response.result = await handler(req.params);
              } catch (err) {
                response.error =
                  err instanceof Error ? err.message : String(err);
              }
            }

            writeOrBuffer(socket, encodeFrame(response));
          }
        },

        close(socket) {
          const decoder: FrameDecoder = (socket as any)._decoder;
          decoder?.reset();
          self.sockets.delete(socket);
          console.log(`[tcp-rpc] client disconnected`);
        },

        drain(socket) {
          flushSocket(socket);
        },

        error(_socket, err) {
          console.error(`[tcp-rpc] socket error:`, err.message);
        },
      },
    });

    console.log(`[tcp-rpc] server listening on ${host}:${port}`);
  }

  broadcast(event: string, data?: unknown): void {
    const frame = encodeFrame({ type: "event", event, data } satisfies RpcEvent);
    for (const socket of this.sockets) {
      writeOrBuffer(socket, frame);
    }
  }

  broadcastTo(socket: any, event: string, data?: unknown): void {
    const frame = encodeFrame({ type: "event", event, data } satisfies RpcEvent);
    writeOrBuffer(socket, frame);
  }

  private _dispatchEvent(event: string, data: unknown, socket: any) {
    const handlers = this.eventListeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data, socket);
    }
  }

  stop() {
    this.server?.stop(true);
    this.server = null;
    console.log(`[tcp-rpc] server stopped`);
  }
}
