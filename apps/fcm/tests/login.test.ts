import { describe, expect, test } from "bun:test";
import { IqStanza_IqType, LoginRequest_AuthService, SelectiveAck } from "../gen/mcs.ts";
import {
  SELECTIVE_ACK_EXTENSION_ID,
  buildLoginRequest,
  buildSelectiveAck,
} from "../src/mcs/login.ts";

describe("buildLoginRequest", () => {
  test("matches expected shape", () => {
    const r = buildLoginRequest(0x1122334455667788n, 9n, ["p1"]);
    expect(r.user).toBe("1234605616436508552");
    expect(r.resource).toBe(r.user);
    expect(r.authToken).toBe("9");
    expect(r.domain).toBe("mcs.android.com");
    expect(r.deviceId).toBe("android-1122334455667788");
    expect(r.useRmq2).toBe(true);
    expect(r.adaptiveHeartbeat).toBe(false);
    expect(r.receivedPersistentId).toEqual(["p1"]);
    expect(r.setting).toHaveLength(1);
    expect(r.setting[0]!.name).toBe("new_vc");
    expect(r.authService).toBe(LoginRequest_AuthService.ANDROID_ID);
    expect(r.networkType).toBe(1);
  });
});

describe("buildSelectiveAck", () => {
  test("wraps ids in extension id 12", () => {
    const iq = buildSelectiveAck(["a", "b"], 7);
    expect(iq.id).toBe("7");
    expect(iq.type).toBe(IqStanza_IqType.SET);
    expect(iq.extension!.id).toBe(SELECTIVE_ACK_EXTENSION_ID);
    const inner = SelectiveAck.decode(iq.extension!.data!);
    expect(inner.id).toEqual(["a", "b"]);
  });
});
