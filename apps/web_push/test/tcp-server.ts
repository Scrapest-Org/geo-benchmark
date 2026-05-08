import { TcpRpcServer } from "@scrapest/tcp-rpc";

export const tcpRpcServer = new TcpRpcServer({ port: 4001 });
tcpRpcServer.listen();

for (let i = 0; i < 10; i++) {
  await Bun.sleep(1_000 * i);
  console.log(`Dispatching event ${i + 1}`);
  tcpRpcServer.broadcast("dispatch-events", { payload: [] });
  console.log("Event dispatched");
}

process.exit(0);
