import { afterEach, describe, expect, test } from "bun:test";
import {
  AndroidCheckinProto_DeviceType,
  AndroidCheckinRequest,
  AndroidCheckinResponse,
  ChromeBuildProto_Channel,
  ChromeBuildProto_Platform,
} from "../gen/checkin.ts";
import { checkin } from "../src/checkin.ts";
import { register } from "../src/register.ts";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

function installFetchMock(responder: (req: Request) => Response | Promise<Response>): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = init?.body
      ? typeof init.body === "string"
        ? new TextEncoder().encode(init.body)
        : new Uint8Array(init.body as ArrayBuffer)
      : new Uint8Array();
    captured.push({
      url: req.url,
      method: req.method,
      headers: new Headers(req.headers),
      body,
    });
    return responder(req);
  }) as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
}

describe("checkin", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  test("returns android_id and security_token; sends well-formed AndroidCheckinRequest", async () => {
    const resp = AndroidCheckinResponse.encode({
      statsOk: true,
      androidId: "0x0123456789abcdef",
      securityToken: "0xCAFEBABEDEADBEEF",
      timeMsec: "1700000000000",
      setting: [],
      deleteSetting: [],
    } as AndroidCheckinResponse).finish();
    const responseBytes = AndroidCheckinResponse.encode({
      statsOk: true,
      androidId: BigInt("0x0123456789abcdef").toString(),
      securityToken: BigInt("0xCAFEBABEDEADBEEF").toString(),
      timeMsec: "1700000000000",
      setting: [],
      deleteSetting: [],
    } as AndroidCheckinResponse).finish();
    void resp;
    const mock = installFetchMock(
      () => new Response(responseBytes as BodyInit, { status: 200 }),
    );
    restore = mock.restore;

    const cred = await checkin("https://example.test/checkin");
    expect(cred.androidId).toBe(BigInt("0x0123456789abcdef"));
    expect(cred.securityToken).toBe(BigInt("0xCAFEBABEDEADBEEF"));

    expect(mock.captured).toHaveLength(1);
    const req = mock.captured[0]!;
    expect(req.headers.get("content-type")).toBe("application/x-protobuf");
    const parsed = AndroidCheckinRequest.decode(req.body);
    expect(parsed.checkin?.type).toBe(AndroidCheckinProto_DeviceType.DEVICE_CHROME_BROWSER);
    expect(parsed.checkin?.chromeBuild?.platform).toBe(ChromeBuildProto_Platform.PLATFORM_MAC);
    expect(parsed.checkin?.chromeBuild?.channel).toBe(ChromeBuildProto_Channel.CHANNEL_STABLE);
    expect(parsed.checkin?.chromeBuild?.chromeVersion).toMatch(/^Chrome\//);
    expect(parsed.version).toBe(3);
    expect(parsed.userSerialNumber).toBe(0);
  });

  test("errors when android_id missing in response", async () => {
    const responseBytes = AndroidCheckinResponse.encode({
      statsOk: true,
      setting: [],
      deleteSetting: [],
    } as AndroidCheckinResponse).finish();
    const mock = installFetchMock(() => new Response(responseBytes as BodyInit, { status: 200 }));
    restore = mock.restore;
    await expect(checkin("https://example.test/checkin")).rejects.toThrow(/android_id/);
  });
});

describe("register", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  test("returns FCM token on success", async () => {
    const mock = installFetchMock(
      () =>
        new Response("token=ePz5ZG7d9Aw:APA91bExampleTokenForTesting1234567890", { status: 200 }),
    );
    restore = mock.restore;
    const tok = await register(
      "https://example.test/register3",
      BigInt("0x0123456789abcdef"),
      BigInt("0xCAFEBABEDEADBEEF"),
      "wp:11111111-1111-1111-1111-111111111111",
      "Bsenderkeyexample",
    );
    expect(tok).toBe("ePz5ZG7d9Aw:APA91bExampleTokenForTesting1234567890");

    const req = mock.captured[0]!;
    const auth = req.headers.get("authorization")!;
    expect(auth).toMatch(/^AidLogin /);
    const body = new TextDecoder().decode(req.body);
    expect(body).toContain("app=org.chromium.linux");
    expect(body).toContain("X-subtype=wp:11111111-1111-1111-1111-111111111111");
    expect(body).toContain("sender=Bsenderkeyexample");
  });

  test("surfaces Error= response", async () => {
    const mock = installFetchMock(
      () => new Response("Error=PHONE_REGISTRATION_ERROR", { status: 200 }),
    );
    restore = mock.restore;
    await expect(
      register("https://example.test/register3", 1n, 2n, "uuid", "Bsender"),
    ).rejects.toThrow(/PHONE_REGISTRATION_ERROR/);
  });
});
