import { redis } from "@scrapest/config";
import { KEYS } from "@scrapest/constants";
import type SourceEvent from "@scrapest/core/resolvers";
import type { WebSocket } from "ws";

export const SSE_PUBLIC_AUTH = "PUBLIC_FEED";
export const SSE_TOKEN_KEY = (token: string) => `sse:token:${token}`;

const SSE_BUFFER_SIZE = 5;

const isFullXPayload = (source: SourceEvent["source"]) => source === "x";

export type Socket = WebSocket & {
  data: SocketData;
};

export interface SocketData {
  auth: string;
  connectedAt: number;
  lastSeen: number;
  useFastX: boolean;
  ignoreFullPayload?: boolean;
}

export class SocketRegistry {
  private static clients = new Map<string, Set<Socket>>();

  public static add(ws: Socket) {
    const { auth } = ws.data;
    if (!this.clients.has(auth)) {
      this.clients.set(auth, new Set());
    }
    this.clients.get(auth)!.add(ws);
  }

  public static remove(ws: Socket) {
    const { auth } = ws.data;
    const userSockets = this.clients.get(auth);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) {
        this.clients.delete(auth);
      }
    }
  }

  public static heartbeat(ws: Socket) {
    ws.data.lastSeen = Date.now();
  }

  public static broadcast(targets: string[], payload: SourceEvent) {
    const isFastX = payload.source === "fast-x";
    const isFullX = payload.source === "x";
    const message = JSON.stringify(payload);

    for (const authKey of targets) {
      const userSockets = this.clients.get(authKey);
      if (!userSockets) continue;

      for (const socket of userSockets) {
        if (isFastX && !socket.data.useFastX) continue;
        if (isFullX && socket.data.ignoreFullPayload) continue;

        socket.send(message);
        console.log(`Broadcasted tag ${payload.mid} time`);
      }
    }
  }

  public static getCount() {
    let count = 0;
    this.clients.forEach((set) => (count += set.size));
    return count;
  }

  public static stayAlive() {
    const now = Date.now();
    const pingInterval = 30 * 1000;
    const deadTimeout = 60 * 1000;

    for (const [auth, sockets] of this.clients.entries()) {
      for (const ws of sockets) {
        const timeSinceLastSeen = now - ws.data.lastSeen;

        if (
          timeSinceLastSeen > pingInterval &&
          timeSinceLastSeen < deadTimeout
        ) {
          ws.ping();
        }
        if (timeSinceLastSeen > deadTimeout) {
          console.log(`🧹 | Pruning dead connection for: ${auth}`);
          ws.terminate();
          this.remove(ws);
        }
      }
    }

    setTimeout(() => this.stayAlive(), pingInterval);
  }
}

export type SSEClient = {
  send: (data: string) => void;
  auth: string;
  connectedAt: number;
  useFastX: boolean;
  ignoreFullPayload?: boolean;
};

export class SSERegistry {
  private static clients = new Map<string, Set<SSEClient>>();

  static add(client: SSEClient) {
    const { auth } = client;
    if (!this.clients.has(auth)) {
      this.clients.set(auth, new Set());
    }
    this.clients.get(auth)!.add(client);
  }

  static remove(client: SSEClient) {
    const set = this.clients.get(client.auth);
    if (set) {
      set.delete(client);
      if (set.size === 0) this.clients.delete(client.auth);
    }
  }

  private static shouldSend(client: SSEClient, source: SourceEvent["source"]) {
    if (source === "fast-x" && !client.useFastX) return false;
    if (isFullXPayload(source) && client.ignoreFullPayload) return false;
    return true;
  }

  static broadcast(targets: string[], payload: SourceEvent) {
    const shouldSkipFullXPayload = isFullXPayload(payload.source);

    const privateMessage = `data: ${JSON.stringify(payload)}\n\n`;

    let publicMessage: string | null = null;
    if (!shouldSkipFullXPayload) {
      const payloadSnippet =
        JSON.stringify(payload.payload).slice(0, 100) + "...";
      const strippedData = {
        source: payload.source,
        timestamp: payload.timestamp,
        payload: payloadSnippet,
      };
      publicMessage = `data: ${JSON.stringify(strippedData)}\n\n`;
    }

    for (const authKey of targets) {
      const userSockets = this.clients.get(authKey);
      if (!userSockets) continue;

      const isPublic = authKey === SSE_PUBLIC_AUTH;
      const messageToSend = isPublic ? publicMessage : privateMessage;

      if (!messageToSend) continue;

      for (const client of userSockets) {
        if (!this.shouldSend(client, payload.source)) continue;

        try {
          client.send(messageToSend);
        } catch {
          this.remove(client);
        }
      }
    }
  }

  static stayAlive() {
    const keepAlive = ":\n\n";
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        try {
          client.send(keepAlive);
        } catch {
          this.remove(client);
        }
      }
    }

    setTimeout(() => this.stayAlive(), 15000);
  }
}
