import { TcpRpcClient } from "@scrapest/tcp-rpc";
import { EventEmitter } from "events";

export const tcpRpcClient = new TcpRpcClient("app");

export const internalEmitter = new EventEmitter();
internalEmitter.setMaxListeners(0);
