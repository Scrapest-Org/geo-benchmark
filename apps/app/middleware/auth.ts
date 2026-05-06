import type { Request, Response, NextFunction } from "express";
import { getEnv, redis } from "@scrapest/config";
import { KEYS } from "@scrapest/constants";
import { parseCookies } from "../utils/http";
import { SessionService, SESSION_COOKIE_NAME } from "../services/session";

const adminKey = getEnv("ADMIN_API_KEY");
const sessionService = new SessionService();

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const key = req.headers["x-api-key"];

  if (!key || typeof key !== "string") {
    return res.status(401).json({
      status: "error",
      error: "Missing or invalid x-api-key header",
    });
  }

  try {
    const exists = await redis.sismember(KEYS.API_KEYS, key);

    if (!exists) {
      return res.status(401).json({
        status: "error",
        error: "Invalid API key",
      });
    }

    (req as any).apiKey = key;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({
      status: "error",
      error: "Internal server error during authentication",
    });
  }
}

export async function requireAnyKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const headerAdminKey = req.headers["x-admin-key"];
  const apiKey = req.headers["x-api-key"];

  if (headerAdminKey && headerAdminKey === adminKey) {
    (req as any).auth = {
      isAdmin: true,
      apiKey: adminKey,
    };
    return next();
  }

  if (apiKey && typeof apiKey === "string") {
    try {
      const exists = await redis.sismember(KEYS.API_KEYS, apiKey);

      if (exists) {
        (req as any).auth = { isAdmin: false, apiKey };
        return next();
      }
    } catch (error) {
      console.error("Auth middleware error:", error);
      return res.status(500).json({
        status: "error",
        error: "Internal server error during authentication",
      });
    }
  }

  return res.status(401).json({
    status: "error",
    error: "Missing or invalid authentication header",
  });
}

export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const key = req.headers["x-admin-key"];

  if (!key || typeof key !== "string") {
    return res.status(401).json({
      status: "error",
      error: "Missing or invalid x-admin-key header",
    });
  }

  if (key !== adminKey) {
    return res.status(401).json({
      status: "error",
      error: "Invalid Admin API key",
    });
  }

  next();
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      sessionService.clearSessionCookie(res);
      return res.status(401).json({
        status: "error",
        error: "Authentication required.",
      });
    }

    const session = await sessionService.getSession(sessionToken);

    if (!session) {
      sessionService.clearSessionCookie(res);
      return res.status(401).json({
        status: "error",
        error: "Session expired.",
      });
    }

    req.session = session;
    req.user = session.user;
    sessionService.writeSessionCookie(
      res,
      session.sessionToken,
      session.expiresAt,
    );

    next();
  } catch (error) {
    console.error("Session middleware error:", error);
    return res.status(500).json({
      status: "error",
      error: "Internal session error.",
    });
  }
}
