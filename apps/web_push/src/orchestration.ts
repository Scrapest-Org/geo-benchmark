import type { X, Decrypt } from "@scrapest/core";
import type { Config } from "@scrapest/config";
import type WS from "./ws";

export const loginToX = async (config: Config, x: X) => {
  const { x: xConfig } = config.config;

  if (!xConfig.screen_name || !xConfig.password) {
    throw new Error(
      "Please set your X screen_name and password in config.json",
    );
  }

  if (xConfig.retry <= 0) {
    throw new Error("Login retries exhausted. Check credentials.");
  }

  try {
    console.log(`*| Attempting login...`);
    await x.login(
      xConfig.screen_name,
      xConfig.password,
      xConfig.authentication_secret,
    );

    if (x.cookies?.auth_token && x.cookies?.ct0) {
      console.log("*| Login successful!");

      config.config.x.retry = 5;
      config.config.x.cookies.auth_token = x.cookies.auth_token;
      config.config.x.cookies.ct0 = x.cookies.ct0;

      await config.saveConfig();
    } else throw new Error("Login failed: Missing required session cookies.");
  } catch (e) {
    console.error("Login Error:", e);
    config.config.x.retry--;
    await config.saveConfig();
  }
};

export const setupXPushConfig = async (x: X, ws: WS, decrypt: Decrypt) => {
  if (!ws.endpoint || !decrypt.publicKey || !decrypt.auth) {
    console.error("Cannot setup push: Missing endpoint or crypto keys.");
    return;
  }

  console.log("*| Linking X account to Mozilla Push Service...");

  const response = await x.postNotificationsLogin(
    ws.endpoint,
    decrypt.publicKey,
    decrypt.auth,
  );

  console.log(response.ok, response.status, response.statusText);
  if (!response.ok) {
    throw new Error(
      `Failed to setup X Push Config (${response.status}): ${response.statusText}`,
    );
  }

  console.log("🚀| X Push Config active.");
};
