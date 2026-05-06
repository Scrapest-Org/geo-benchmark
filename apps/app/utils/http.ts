import type { Response } from "express";

type CookieSameSite = "Strict" | "Lax" | "None";

type CookieOptions = {
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: CookieSameSite;
  secure?: boolean;
};

function parseCookies(header?: string | null) {
  if (!header) return {} as Record<string, string>;

  return header.split(";").reduce(
    (acc, part) => {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (!rawName) return acc;

      acc[decodeURIComponent(rawName)] = decodeURIComponent(rawValue.join("="));
      return acc;
    },
    {} as Record<string, string>,
  );
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}

function appendSetCookie(res: Response, cookie: string | string[]) {
  const cookies = Array.isArray(cookie) ? cookie : [cookie];
  const existing = res.getHeader("Set-Cookie");

  if (!existing) {
    res.setHeader("Set-Cookie", cookies);
    return;
  }

  const current = Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader("Set-Cookie", [...current, ...cookies]);
}

function clearCookie(
  name: string,
  options: Omit<CookieOptions, "expires" | "maxAge"> = {},
) {
  return serializeCookie(name, "", {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  });
}

export { appendSetCookie, clearCookie, parseCookies, serializeCookie };

export type { CookieOptions };
