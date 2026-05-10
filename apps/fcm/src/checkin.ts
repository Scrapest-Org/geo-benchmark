// Android checkin: bootstraps a fresh `(android_id, security_token)` from
// Google. 1:1 port of `src/checkin.rs`.

import {
  AndroidCheckinProto_DeviceType,
  AndroidCheckinRequest,
  AndroidCheckinResponse,
  ChromeBuildProto_Channel,
  ChromeBuildProto_Platform,
} from "../gen/checkin.ts";

export const CHECKIN_URL = "https://android.clients.google.com/checkin";
export const CHROME_VERSION = "147.0.7390.65";

export interface CheckinCredentials {
  androidId: bigint;
  securityToken: bigint;
}

export async function checkin(url: string = CHECKIN_URL): Promise<CheckinCredentials> {
  const req: AndroidCheckinRequest = buildRequest();
  const body = AndroidCheckinRequest.encode(req).finish();

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-protobuf",
      "user-agent": `Chrome/${CHROME_VERSION} (Macintosh; Intel Mac OS X 10_15_7)`,
    },
    body,
  });

  const buf = new Uint8Array(await resp.arrayBuffer());
  if (!resp.ok) {
    const text = new TextDecoder().decode(buf);
    throw new Error(`checkin HTTP ${resp.status}: ${text}`);
  }
  const parsed = AndroidCheckinResponse.decode(buf);
  if (parsed.androidId === undefined || parsed.androidId === "0") {
    throw new Error("checkin response missing android_id");
  }
  if (parsed.securityToken === undefined || parsed.securityToken === "0") {
    throw new Error("checkin response missing security_token");
  }
  return {
    androidId: BigInt(parsed.androidId),
    securityToken: BigInt(parsed.securityToken),
  };
}

function buildRequest(): AndroidCheckinRequest {
  // For first-time checkin we leave `id` and `security_token` unset — the
  // server assigns both. Setting `id = -1` explicitly trips Google's "bad
  // security token" check; matching push-receiver's wire shape avoids this.
  return {
    checkin: {
      type: AndroidCheckinProto_DeviceType.DEVICE_CHROME_BROWSER,
      chromeBuild: {
        platform: ChromeBuildProto_Platform.PLATFORM_MAC,
        chromeVersion: `Chrome/${CHROME_VERSION}`,
        channel: ChromeBuildProto_Channel.CHANNEL_STABLE,
      },
    },
    version: 3,
    userSerialNumber: 0,
    macAddr: [],
    accountCookie: [],
    otaCert: [],
    macAddrType: [],
  } as AndroidCheckinRequest;
}
