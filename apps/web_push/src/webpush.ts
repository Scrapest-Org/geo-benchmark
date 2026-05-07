import { loginToX, setupXPushConfig } from "./orchestration";
import { TIME, VAPID } from "@scrapest/constants";
import { Config, redis } from "@scrapest/config";
import { Decrypt, X, type Account } from "@scrapest/core";
import WS from "./ws";
import "@scrapest/core/utils/console";

let checkinInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let ws: WS | null = null;
let x: X | null = null;

const updateStatus = async (status: string, instanceId: string) => {
  const health = {
    status,
    last_checkin: new Date().toISOString(),
    next_checkin: new Date(Date.now() + TIME._10MIN).toISOString(),
    is_registered: !!ws?.endpoint && !!ws?.uaid,
    ws_connected: ws ? !ws.isClosed : false,
    x_authenticated: !!x?.cookies?.auth_token || false,
    instance_id: instanceId,
  };

  await redis.set(
    `health:${instanceId}`,
    JSON.stringify(health),
    "EX",
    Math.floor((TIME._10MIN * 2) / 1000),
  );
};

function startHealthHeartbeat(instanceId: string) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  heartbeatInterval = setInterval(async () => {
    await updateStatus(ws ? ws.status() : "error_not_initialized", instanceId);
  }, TIME._10MIN);
}

async function setup(acc: Account, instanceId: string) {
  await updateStatus("initializing", instanceId);

  const config = new Config(acc, instanceId);
  const decrypt = new Decrypt();
  await decrypt.init(config.config.jwk, config.config.auth);

  if (!config.config.jwk.d || !(config.config.jwk.x && config.config.jwk.y)) {
    const { jwk, auth } = await decrypt.exportKey();
    config.config.jwk = jwk;
    config.config.auth = auth;
    await config.saveConfig();
  }

  x = new X(config.config.x.cookies);
  if (!x.cookies?.auth_token || !x.cookies?.ct0) {
    console.log("*| No session found. Logging in...");
    await loginToX(config, x);
  }

  const ap = config.config.autopush;
  ws = new WS(
    decrypt,
    ap.uaid,
    ap.remote_settings__monitor_changes,
    ap.endpoint,
    ap.channel_id,
    instanceId,
  );
  ws.initWebsocket();

  let alreadyRegistered = !!ap.endpoint;
  let loopCount = 0;

  while (true) {
    await updateStatus("syncing_mozilla", instanceId);
    if (ws.isClosed) {
      loopCount++;
      console.log(`*| Waiting for Mozilla connection... (${loopCount}s)`);
    } else {
      // Sync uaid once received from Mozilla
      if (!config.config.autopush.uaid && ws.uaid) {
        config.config.autopush.uaid = ws.uaid;
        await config.saveConfig();
      }

      if (!config.config.autopush.endpoint) {
        if (!alreadyRegistered) {
          console.log("*| Registering VAPID with Mozilla...");
          await ws.register(VAPID);
          alreadyRegistered = true;
        }
        if (ws.endpoint) {
          config.config.autopush.channel_id = ws.channelID;
          config.config.autopush.endpoint = ws.endpoint;

          console.log("*| Linking X account to new endpoint...");
          await setupXPushConfig(x, ws, decrypt);
          await config.saveConfig();
        }
      }
    }

    const ap = config.config.autopush;
    if (ap.uaid && ap.endpoint) {
      console.log("🚀| Web Push System fully synchronized.");
      break;
    }

    await Bun.sleep(TIME.SECOND);
  }

  const xCheckIn = async () => {
    await updateStatus("syncing_x_checkin", instanceId);
    if (!ws || !x) {
      console.error(
        "X| Cannot setup checkin: Missing WebSocket or X instance.",
      );
      return;
    }
    if (!ws.endpoint || !decrypt.publicKey || !decrypt.auth) {
      console.error(
        "X| Cannot setup checkin: Missing endpoint or crypto keys.",
      );
      const missingEndpoint = Boolean(ws.endpoint);
      await updateStatus(
        missingEndpoint
          ? "error_missing_endpoint"
          : "error_missing_crypto_keys",
        instanceId,
      );
      return;
    }
    console.log(`*| Running session check-in...`);
    try {
      const response = await x.postNotificationsCheckin(
        ws.endpoint,
        decrypt.publicKey,
        decrypt.auth,
      );

      if (!response.ok) {
        console.warn(
          "!| Check-in failed. Refreshing session...",
          response.status,
          response.statusText,
          await response.text(),
        );
        await loginToX(config, x);
        await setupXPushConfig(x, ws, decrypt);
      }
      console.log(`*| Check-in successful. ${response.status}`);
      await updateStatus("indexing", instanceId);
    } catch (e) {
      console.error("X| Check-in error:", e);
      await updateStatus("error_lost_connection", instanceId);
    }
  };
  await xCheckIn();
  startHealthHeartbeat(instanceId);

  checkinInterval = setInterval(xCheckIn, TIME.CHECK);
}

async function teardown(instanceId: string) {
  if (checkinInterval) clearInterval(checkinInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (ws) {
    if (x && ws.endpoint) {
      await x.postNotificationsLogout(ws.endpoint).catch(() => {});
      ws.unregister();
    }
    ws.close();
  }
  x = null;
  ws = null;
  checkinInterval = null;

  const login = await redis.get(`claim:${instanceId}`);
  const keysToDel = [
    `health:${instanceId}`,
    `config:${instanceId}`,
    `claim:${instanceId}`,
  ];
  if (login) keysToDel.push(`in_use:${login}`);

  await redis.del(...keysToDel);
}

export { setup, teardown, ws, x };
