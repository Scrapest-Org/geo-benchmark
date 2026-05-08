import { encodeFrame, FrameDecoder } from "./framing";

const MAX_FRAME_BYTES = 64 * 1024; // 64KB

export class TcpRpcServer {
  private handlers = new Map<string, RpcHandler>();
  private options: Required<TcpRpcServerOptions>;
  private server: { stop: (force?: boolean) => void } | null = null;

  constructor(options: TcpRpcServerOptions) {
    this.options = {
      host: "0.0.0.0",
      ...options,
    };
  }

  handle<P = unknown, R = unknown>(method: string, handler: RpcHandler<P, R>) {
    this.handlers.set(method, handler as RpcHandler);
    return this;
  }

  listen() {
    const { port, host } = this.options;
    const handlers = this.handlers;

    this.server = Bun.listen({
      hostname: host,
      port,
      socket: {
        open(socket) {
          (socket as any)._decoder = new FrameDecoder();
          console.log(`[tcp-rpc] client connected`);
        },

        async data(socket, chunk) {
          const decoder: FrameDecoder = (socket as any)._decoder;
          const messages = decoder.feed(Buffer.from(chunk));

          for (const message of messages) {
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
          console.log(`[tcp-rpc] client disconnected`);
        },

        error(_socket, err) {
          console.error(`[tcp-rpc] socket error:`, err.message);
        },
      },
    });

    console.log(`[tcp-rpc] server listening on ${host}:${port}`);
  }

  stop() {
    this.server?.stop(true);
    this.server = null;
    console.log(`[tcp-rpc] server stopped`);
  }
}
