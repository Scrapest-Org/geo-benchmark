// Helpers for building the MCS `LoginRequest` and `SelectiveAck` IqStanza.
// 1:1 port of `src/mcs/login.rs` — same constants, same field set.

import {
  IqStanza,
  IqStanza_IqType,
  type LoginRequest,
  LoginRequest_AuthService,
  SelectiveAck,
} from "../../gen/mcs.ts";

export const SELECTIVE_ACK_EXTENSION_ID = 12;
export const STREAM_ACK_EXTENSION_ID = 13;

export const LOGIN_ID = "chrome-147.0.7390.65";
export const MCS_DOMAIN = "mcs.android.com";

export function buildLoginRequest(
  androidId: bigint,
  securityToken: bigint,
  receivedPersistentIds: string[],
): LoginRequest {
  const aid = androidId.toString();
  const deviceId = `android-${androidId.toString(16).padStart(16, "0")}`;
  return {
    id: LOGIN_ID,
    domain: MCS_DOMAIN,
    user: aid,
    resource: aid,
    authToken: securityToken.toString(),
    deviceId,
    lastRmqId: "1",
    setting: [{ name: "new_vc", value: "1" }],
    receivedPersistentId: receivedPersistentIds,
    adaptiveHeartbeat: false,
    useRmq2: true,
    authService: LoginRequest_AuthService.ANDROID_ID,
    networkType: 1,
    clientEvent: [],
  };
}

export function buildSelectiveAck(ids: string[], iqId: number | bigint): IqStanza {
  const inner: SelectiveAck = { id: ids };
  const data = SelectiveAck.encode(inner).finish();
  return {
    type: IqStanza_IqType.SET,
    id: iqId.toString(),
    extension: { id: SELECTIVE_ACK_EXTENSION_ID, data },
    setting: [],
  } as IqStanza;
}
