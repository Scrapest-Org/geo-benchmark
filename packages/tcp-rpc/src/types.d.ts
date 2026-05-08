interface RpcRequest {
  type?: "request";
  id: string;
  method: string;
  params: unknown;
}

interface RpcResponse {
  type?: "response";
  id: string;
  result?: unknown;
  error?: string;
}

interface RpcEvent {
  type: "event";
  event: string;
  data?: unknown;
}

type RpcHandler<P = unknown, R = unknown> = (params: P) => Promise<R>;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TcpRpcServerOptions {
  port: number;
  host?: string;
}

interface TcpRpcClientOptions {
  host: string;
  port: number;
  timeout?: number; // default call timeout in ms (default: 10_000)
  reconnectDelay?: number; // base reconnect delay in ms (default: 500)
  maxReconnectDelay?: number;
}

type BunSocket = Awaited<ReturnType<typeof Bun.connect>>;
