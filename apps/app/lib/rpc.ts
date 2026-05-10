import { TcpRpcServer, RPC_REGISTRY } from "@scrapest/tcp-rpc";

export const tcpRpcServer = new TcpRpcServer({
  port: RPC_REGISTRY.app.port,
});
tcpRpcServer.listen();
