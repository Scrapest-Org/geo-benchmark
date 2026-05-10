//-> node.js only
import { WebSocket } from "ws";
import type { CloseEvent, ErrorEvent, MessageEvent } from "ws";
import crypto from "crypto";
//<--
import {
  base64_to_buffer,
  base64url_to_base64,
} from "@scrapest/core/utils/encrypt-decrypt";
import type { Decrypt } from "@scrapest/core";
import { fireFoxUserAgent, TIME } from "@scrapest/constants";
import { getEnv } from "@scrapest/config";
import { userCache } from "./helpers";
import SourceEvent from "@scrapest/core/resolvers";
import { appClient, internalEmitter } from "./rpc";

type SendJSONPayload = {
  messageType: string;
  [key: string]: any;
};

const STALE_WS = 1000 * 60 * 15.5;
const vm = getEnv("VM_NAME");

class WS {
  private _ws: WebSocket | null = null;
  private decrypt: Decrypt;
  private remote_settings__monitor_changes = "";
  private isNode = false;
  private keepStop = false;
  private latestPing = Date.now();
  private retryCount = 0;
  private _selfCheckInterval: NodeJS.Timeout | null = null;

  public uaid = "";
  public endpoint = "";
  public channelID = "";
  public isClosed = true;

  constructor(
    decrypt: Decrypt,
    uaid = "",
    remote_settings__monitor_changes = "",
    endpoint = "",
    channelID = "",
  ) {
    this.decrypt = decrypt;
    this.uaid = uaid;
    this.remote_settings__monitor_changes = remote_settings__monitor_changes;
    this.endpoint = endpoint;
    this.channelID = channelID;
    this.selfCheck();
  }

  public status() {
    if (!this._ws) return "not initialized";
    if (this._ws.readyState === WebSocket.OPEN) return "indexing";
    if (this._ws.readyState === WebSocket.CLOSED) return "closed";
    if (this._ws.readyState === WebSocket.CONNECTING) return "error_connecting";
    return "error_unknown";
  }

  public initWebsocket() {
    this.keepStop = false;
    this._ws = new WebSocket("wss://push.services.mozilla.com/", {
      protocol: "push-notification",
      headers: {
        "User-Agent": fireFoxUserAgent,
      },
    });

    this.isNode = this._ws.on !== undefined;
    this.initWebsocketEvents();
  }

  private sendJSON(obj: SendJSONPayload) {
    try {
      if (!this._ws) throw new Error("WebSocket is not initialized");
      if (this._ws?.readyState !== WebSocket.OPEN)
        throw new Error("WebSocket is not open");

      const msg = JSON.stringify(obj);
      this._ws.send(msg);
      console.log("↑|", obj.messageType);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      console.error(`Failed to sendJSON: ${e.message}`);
    }
  }

  async register(VAPID: string, channelID = "") {
    if (!VAPID) {
      console.error("VAPID is required!");
      return;
    }

    if (channelID) this.channelID = channelID;
    else if (!this.channelID) this.channelID = crypto.randomUUID();

    this.sendJSON({
      channelID: this.channelID,
      messageType: "register",
      key: VAPID,
    });
  }
  async unregister(channelID = "") {
    if (channelID === this.channelID) this.channelID = "";
    else channelID = this.channelID;

    this.sendJSON({ messageType: "unregister", channelID, status: 200 });
  }

  private ack(channelID: string, version: string) {
    this.sendJSON({
      messageType: "ack",
      updates: [{ channelID, version, code: 100 }],
    });
  }

  close() {
    if (!this._ws) return;
    this._ws.close();
    this._ws = null;
    this.keepStop = true;
    if (this._selfCheckInterval) {
      clearInterval(this._selfCheckInterval);
      this._selfCheckInterval = null;
    }
  }

  // events
  private onOpen() {
    this.isClosed = false;
    this.latestPing = Date.now();
    this.retryCount = 0;
    console.log("~| Connected to Mozilla Push Service");

    this.sendJSON({
      messageType: "hello",
      broadcasts: {
        "remote-settings/monitor_changes":
          this.remote_settings__monitor_changes || undefined,
      },
      use_webpush: true,
      uaid: this.uaid,
    });
  }

  private onClosed(event: CloseEvent) {
    this.isClosed = true;
    console.warn(
      `Connection Lost. Code: ${event.code}, Reason: ${event.reason}`,
    );
    if (!this.keepStop) {
      const delay =
        this.retryCount === 0
          ? 200
          : Math.min(Math.pow(2, this.retryCount) * 1000, 30000);
      this.retryCount++;

      console.warn(
        `Disconnected. Retrying in ${delay / 1000}s... (Attempt ${this.retryCount})`,
      );
      setTimeout(() => this.initWebsocket(), delay);
    }
  }

  private onError(error: ErrorEvent) {
    console.error(`WS Error: ${error.message}`);
  }

  private onMessage(event: MessageEvent) {
    const message = JSON.parse(event.data.toString());
    console.log("↓| Incoming:", message.messageType);
    const broadcast = message?.broadcasts?.["remote-settings/monitor_changes"];

    switch (message.messageType) {
      case "hello":
        this.uaid = message.uaid;
        if (broadcast) this.remote_settings__monitor_changes = broadcast;
        break;
      case "register":
        this.endpoint = message.pushEndpoint;
        this.channelID = message.channelID;
        break;
      case "notification":
        this.ack(message.channelID, message.version);
        this.decryptData(message).catch((e) =>
          console.error("Decrypt error:", (e as Error).message),
        );
        break;
      case "broadcast":
        if (broadcast) this.remote_settings__monitor_changes = broadcast;
        break;
      default:
        console.log(`↓| [RAW] ${JSON.stringify(message)}`);
        break;
    }
  }

  private pingCount = 0;

  private onPing() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this.latestPing = Date.now();

    this.pingCount++;
    console.log("~| Received ping!", `total: ${this.pingCount}`);
  }

  private initWebsocketEvents() {
    if (!this._ws) return;
    this._ws.addEventListener("error", (event) => this.onError(event));
    this._ws.addEventListener("open", () => this.onOpen());
    this._ws.addEventListener("message", (event) => this.onMessage(event));
    this._ws.addEventListener("close", (e) => this.onClosed(e));

    // node.js only
    if (this.isNode) {
      this._ws.on("ping", this.onPing.bind(this));
      this._ws.on("pong", () => {
        this.latestPing = Date.now();
        console.log("~| Received pong!");
      });
    }
  }

  private selfCheck() {
    if (this._selfCheckInterval) {
      clearInterval(this._selfCheckInterval);
    }

    this._selfCheckInterval = setInterval(() => {
      if (this.isNode && this._ws) {
        const timeSince = Date.now() - this.latestPing;
        console.log("+|", "auto check", `${timeSince / 1000}s`);

        if (
          !this.isClosed &&
          (timeSince > STALE_WS || this._ws.readyState === WebSocket.CLOSING)
        ) {
          console.warn("🚨 Socket is stale or hanging. Terminating now...");
          this._ws.terminate();
        }
      }
    }, 60000);
  }

  private async decryptData(parsedData: any) {
    const now = Date.now();
    this.latestPing = now;

    try {
      const crypto_key = Object.fromEntries(
        parsedData.headers.crypto_key
          .split(";")
          .map((v: string) => v.split("=")),
      );

      const dh = base64_to_buffer(base64url_to_base64(crypto_key.dh));
      const salt = base64_to_buffer(
        base64url_to_base64(parsedData.headers.encryption.split("=")[1]),
      );
      const { CEK, NONCE } = await this.decrypt.get_cek_and_nonce(
        new Uint8Array(dh),
        new Uint8Array(salt),
      );
      const { data: decryptedData } = await this.decrypt.decrypt(
        NONCE,
        CEK,
        base64_to_buffer(base64url_to_base64(parsedData.data)),
      );

      console.time("decrypt");
      const text = new TextDecoder().decode(decryptedData);
      const tweetData: XPostData = JSON.parse(text);
      if (!tweetData.tag) {
        console.info("Skipping non-tweet notification...", text);
        return;
      }

      const tag = tweetData.tag.replace(/[^\d]+\-/gm, "");
      const sft = Number(
        ((BigInt(tag) >> BigInt(22)) & BigInt(2199023255551)) +
          BigInt(1288834974657),
      );

      console.log(
        "~|",
        `[mozilla] post ${tag} >>${Number(tweetData.timestamp) - sft}ms>> autopush >>${now - Number(tweetData.timestamp)}ms>> client`,
      );

      const uname = tweetData.data.uri.split("/")[1] || "unknown";
      const authorId = userCache.get(uname);

      const tweet: XPostNotification = {
        id: tag,
        text: tweetData.body,
        author: {
          name: tweetData.title,
          screen_name: uname,
          profile_image_url: tweetData.icon,
          id: authorId || "generic-x39r",
        },
        timestamp: Number(tweetData.timestamp),
        url: `https://x.com${tweetData.data.uri}`,
        lang: tweetData.lang,
      };

      console.log(`Broadcast ${tag} time`);
      const tweetEvent = new SourceEvent("fast-x", tweet, vm, sft);
      appClient.emit("dispatch-events", { payload: [tweetEvent] });
      console.timeEnd("decrypt");
      internalEmitter.emit("new-tweet", { tag, rcv: sft });
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      console.error("Error decrypting notification:", e.message);
    }
  }
}

export default WS;
