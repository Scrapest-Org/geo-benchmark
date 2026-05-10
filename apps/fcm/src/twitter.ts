// Twitter web-push subscription. 1:1 port of `src/twitter.rs`.

export const TWITTER_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export const SUBSCRIBE_URL = "https://x.com/i/api/1.1/notifications/settings/login.json";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

/** Twitter's web-push VAPID public key — extracted from
 *  `https://abs.twimg.com/responsive-web/client-serviceworker/serviceworker.*.js`.
 *  This MUST be the `sender=` value when calling `c2dm/register3` for a
 *  Twitter receiver, because FCM binds the subscription to it. */
export const TWITTER_VAPID_PUBLIC_KEY =
  "BF5oEo0xDUpgylKDTlsd8pZmxQA1leYINiY-rSscWYK_3tWAkz4VMbtf1MLE_Yyd6iII6o-e3Q9TCN5vZMzVMEs";

export interface Cookies {
  authToken: string;
  ct0: string;
}

export class TwitterAuthError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`auth failed (status ${status}): paste fresh auth_token/ct0 cookies`);
    this.name = "TwitterAuthError";
  }
}

export class TwitterHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Twitter responded ${status}: ${body}`);
    this.name = "TwitterHttpError";
  }
}

export async function subscribe(
  url: string,
  fcmEndpoint: string,
  uaPublicB64: string,
  authSecretB64: string,
  cookies: Cookies,
  locale: string,
): Promise<string> {
  const body = JSON.stringify({
    push_device_info: {
      os_version: "Mac/Chrome",
      udid: "Mac/Chrome",
      env: 3,
      locale,
      protocol_version: 1,
      token: fcmEndpoint,
      encryption_key1: uaPublicB64,
      encryption_key2: authSecretB64,
    },
  });
  const cookieHeader = `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TWITTER_BEARER}`,
      "x-csrf-token": cookies.ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": locale,
      "content-type": "application/json",
      cookie: cookieHeader,
      "user-agent": USER_AGENT,
    },
    body,
  });
  const text = await resp.text();
  if (resp.status >= 200 && resp.status < 300) return text;
  if (resp.status === 401 || resp.status === 403) throw new TwitterAuthError(resp.status, text);
  throw new TwitterHttpError(resp.status, text);
}
