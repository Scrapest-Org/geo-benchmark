import { TcpRpcServer } from "@scrapest/tcp-rpc";
import { EventEmitter } from "events";

export const tcpRpcServer = new TcpRpcServer({ port: 4001 });
tcpRpcServer.listen();

export const internalEmitter = new EventEmitter();
internalEmitter.setMaxListeners(0);
