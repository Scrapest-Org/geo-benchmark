const isProd = process.env.NODE_ENV === "production";

export const RPC_REGISTRY = {
  app: {
    host: isProd ? "app" : "localhost",
    port: 4000,
  },
  webpush: {
    host: isProd ? "web-push" : "localhost",
    port: 4001,
  },
} as const;

export type RpcServiceName = keyof typeof RPC_REGISTRY;
