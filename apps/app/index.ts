import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { router, app as appService, client } from "./routes";
import { SocketRegistry, SSERegistry, type Socket } from "./services/ws";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { redis } from "@scrapest/config";
import { KEYS, APP_URL } from "@scrapest/constants";
import "@scrapest/core/utils/console";
import { closeQueues } from "./utils/queues";
import "./workers/app.worker";
import { warmup } from "./lib/api-key-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const allowedOrigins = new Set([
  APP_URL,
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const app = express();
app.set("trust proxy", true);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-API-Key, X-Admin-Key",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(bodyParser.json());
app.use("/internal", bodyParser.json({ limit: "5mb" }));

app.use("/", router);

app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "scrapest.html"));
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  const apiKey = request.headers["x-api-key"] as string;

  const useFastX = url.searchParams.get("useFastX") === "true";
  const ignoreFullPayload =
    url.searchParams.get("ignoreFullPayload") === "true";

  if (url.pathname === "/ws") {
    if (!apiKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as Socket).data = {
        auth: apiKey,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        useFastX,
        ignoreFullPayload,
      };
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (ws: Socket) => {
  const exists = await redis.sismember(KEYS.API_KEYS, ws.data.auth);
  if (!exists) {
    ws.emit("error", "API Key not recognized");
    ws.close();
    return;
  }
  SocketRegistry.add(ws);
  console.log(`🔌 | WS Connected. Active: ${SocketRegistry.getCount()}`);

  ws.on("message", (msg: string) => {
    if (msg.toString() === "ping") {
      SocketRegistry.heartbeat(ws);
      ws.pong();
    }
  });

  ws.on("close", () => {
    SocketRegistry.remove(ws);
  });

  ws.on("pong", () => {
    SocketRegistry.heartbeat(ws);
  });
});

await warmup();
const PORT = process.env.PORT || 6969;
server.listen(Number(PORT), "0.0.0.0", async () => {
  console.log(`🚀 Server listening on port ${PORT}`);

  try {
    await appService.initialize();
    SocketRegistry.stayAlive();
    SSERegistry.stayAlive();
  } catch (err) {
    console.error("❌ Initialization failed:", err);
    process.exit(1);
  }
});

await client.connect().catch(() => {
  console.warn("⚠️ Webpush RPC not available yet, retrying...");
});

async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, stopping app service and server...`);
  const forceExitTimeout = setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 15000);

  try {
    appService.stop();
    client.destroy();
    console.log(`Closing ${wss.clients.size} active WebSockets...`);
    for (const client of wss.clients) {
      client.terminate();
    }
    await closeQueues();
    await redis.quit();

    server.close(() => {
      console.log("Server stopped");
      clearTimeout(forceExitTimeout);
      process.exit(0);
    });

    server.closeAllConnections();
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:", err);
  await shutdown("uncaughtException");
});

process.on("unhandledRejection", async (reason) => {
  if (
    typeof reason === "object" &&
    reason &&
    "code" in reason &&
    reason.code === "EPARSE"
  ) {
    console.warn(
      "⚠️ Intercepted a non-JSON response (likely a network block/569). Ignoring...",
    );
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

process.on("beforeExit", async (code) => {
  console.log("Process beforeExit event with code:", code);
  await shutdown("beforeExit");
});
