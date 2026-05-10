import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TwitterAuthError, TwitterHttpError, subscribe } from "../src/twitter.ts";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

const FCM_ENDPOINT =
  "https://fcm.googleapis.com/fcm/send/fnaHgANd1jk:APA91bGI8kL2gbLYMXeL31i7zYFCgXrgy536UPDD9fue36";
const P256DH =
  "BDK2qGp5Efpml3aRJLGxjP74dLUCuzEEo3XN1NNz_iHOLNnj01P3xJlEH8FhX-ubrC3TDjDGIsMLAZIp40tv8V8";
const AUTH_SECRET = "MRCv8wZVqJhnKHWYbNVX3g";
const COOKIES = { authToken: "abc-auth", ct0: "deadbeefct0" };

function installFetchMock(responder: (req: Request) => Response): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    captured.push({
      url: req.url,
      method: req.method,
      headers: new Headers(req.headers),
      body: typeof init?.body === "string" ? init.body : await req.clone().text(),
    });
    return responder(req);
  }) as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
}

describe("twitter.subscribe", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  test("sends expected body and headers", async () => {
    const mock = installFetchMock(() => new Response("{\"ok\":true}", { status: 200 }));
    restore = mock.restore;
    await subscribe(
      "https://example.test/login.json",
      FCM_ENDPOINT,
      P256DH,
      AUTH_SECRET,
      COOKIES,
      "en",
    );
    expect(mock.captured).toHaveLength(1);
    const req = mock.captured[0]!;
    expect(req.headers.get("authorization")).toMatch(/^Bearer AAAAAAAAAAAAAAAAAAAAANRILg/);
    expect(req.headers.get("x-csrf-token")).toBe("deadbeefct0");
    expect(req.headers.get("x-twitter-auth-type")).toBe("OAuth2Session");
    expect(req.headers.get("x-twitter-active-user")).toBe("yes");
    expect(req.headers.get("x-twitter-client-language")).toBe("en");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(req.headers.get("cookie")).toContain("auth_token=abc-auth");
    expect(req.headers.get("cookie")).toContain("ct0=deadbeefct0");
    const json = JSON.parse(req.body);
    const info = json.push_device_info;
    expect(info.os_version).toBe("Mac/Chrome");
    expect(info.udid).toBe("Mac/Chrome");
    expect(info.env).toBe(3);
    expect(info.locale).toBe("en");
    expect(info.protocol_version).toBe(1);
    expect(info.token).toBe(FCM_ENDPOINT);
    expect(info.encryption_key1).toBe(P256DH);
    expect(info.encryption_key2).toBe(AUTH_SECRET);
  });

  test("surfaces auth error on 403", async () => {
    const mock = installFetchMock(() => new Response("forbidden", { status: 403 }));
    restore = mock.restore;
    await expect(
      subscribe("https://example.test/login.json", FCM_ENDPOINT, P256DH, AUTH_SECRET, COOKIES, "en"),
    ).rejects.toBeInstanceOf(TwitterAuthError);
  });

  test("surfaces 5xx as HttpError", async () => {
    const mock = installFetchMock(() => new Response("upstream", { status: 503 }));
    restore = mock.restore;
    await expect(
      subscribe("https://example.test/login.json", FCM_ENDPOINT, P256DH, AUTH_SECRET, COOKIES, "en"),
    ).rejects.toBeInstanceOf(TwitterHttpError);
  });
});
