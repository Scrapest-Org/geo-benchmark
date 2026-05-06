// OAuth 1.0a request signer (HMAC-SHA1) per RFC 5849.
// Used to sign Twitter mobile-API requests with the leaked Android consumer key.

export type Oauth1SignInput = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;                           // full URL incl. query string is ok
  consumerKey: string;
  consumerSecret: string;
  token?: string;                        // omit for 2-legged
  tokenSecret?: string;
  bodyParams?: Record<string, string>;   // application/x-www-form-urlencoded body params
  extraOauthParams?: Record<string, string>;
  _testOverrides?: { oauth_nonce?: string; oauth_timestamp?: string };
};

export type Oauth1SignResult = {
  oauth_signature: string;
  authorizationHeader: string;           // ready-to-use Authorization header value
  params: Record<string, string>;        // all oauth_* params (signed)
};

// RFC 3986 §2.3 — unreserved set is the only no-encode chars.
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildSignatureBaseString(args: {
  method: string;
  url: string;
  params: Record<string, string>;
}): string {
  const u = new URL(args.url);
  const queryParams: Record<string, string[]> = {};
  for (const [k, v] of u.searchParams.entries()) {
    (queryParams[k] ||= []).push(v);
  }
  // Strip query from base URL.
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;

  // Combine: query params + caller params. Multi-value supported.
  const all: { k: string; v: string }[] = [];
  for (const [k, vs] of Object.entries(queryParams)) {
    for (const v of vs) all.push({ k: percentEncode(k), v: percentEncode(v) });
  }
  for (const [k, v] of Object.entries(args.params)) {
    all.push({ k: percentEncode(k), v: percentEncode(v) });
  }

  // Sort by encoded key, then by encoded value.
  all.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.v < b.v ? -1 : a.v > b.v ? 1 : 0));

  const paramString = all.map(({ k, v }) => `${k}=${v}`).join("&");
  return [
    args.method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  // Base64-encode raw signature bytes.
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function signOauth1(input: Oauth1SignInput): Promise<Oauth1SignResult> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce:
      input._testOverrides?.oauth_nonce ??
      // 32 hex chars from random bytes
      Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:
      input._testOverrides?.oauth_timestamp ??
      Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...(input.token ? { oauth_token: input.token } : {}),
    ...(input.extraOauthParams ?? {}),
  };

  const signingParams: Record<string, string> = {
    ...oauthParams,
    ...(input.bodyParams ?? {}),
  };

  const baseString = buildSignatureBaseString({
    method: input.method,
    url: input.url,
    params: signingParams,
  });

  const signingKey = `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret ?? "")}`;
  const signature = await hmacSha1(signingKey, baseString);

  const signedParams = { ...oauthParams, oauth_signature: signature };

  // Build Authorization header. Sort keys for determinism.
  const header =
    "OAuth " +
    Object.entries(signedParams)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ");

  return { oauth_signature: signature, authorizationHeader: header, params: signedParams };
}
