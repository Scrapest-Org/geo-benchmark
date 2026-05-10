import { encodeFrame, FrameDecoder } from "./framing";

const MAX_FRAME_BYTES = 64 * 1024; // 64KB

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

            const frame = encodeFrame(response);
            console.log("[rpc] frame size:", frame.length);

            if (frame.length > MAX_FRAME_BYTES) {
              const errorFrame = encodeFrame({
                id: req.id,
                error: `Response too large: ${frame.length} bytes (max ${MAX_FRAME_BYTES}).`,
              });
              socket.write(errorFrame);
              socket.flush();
              continue;
            }

            socket.write(frame);
            socket.flush();
          }
        },

        close(socket) {
          const decoder: FrameDecoder = (socket as any)._decoder;
          decoder?.reset();
          self.sockets.delete(socket);
          console.log(`[tcp-rpc] client disconnected`);
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
      socket.write(frame);
      socket.flush();
    }
  }

  broadcastTo(socket: any, event: string, data?: unknown): void {
    const frame = encodeFrame({ type: "event", event, data } satisfies RpcEvent);
    socket.write(frame);
    socket.flush();
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
