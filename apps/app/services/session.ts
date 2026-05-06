import type { Response } from "express";
import type { AuthSession, User } from "@scrapest/prisma";
import { appendSetCookie, clearCookie, serializeCookie } from "../utils/http";
import { prisma } from "./prisma";
import { createOpaqueToken } from "../utils/security";
import { appQueue } from "../utils/queues";
import { DASHBOARD_URL } from "./telegram-auth";

const SESSION_COOKIE_NAME = "scrapest_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const secureCookies = DASHBOARD_URL.startsWith("https://");

function buildSessionCookie(token: string, expiresAt: Date) {
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    expires: expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: secureCookies ? "Strict" : "Lax",
    secure: secureCookies,
  });
}

function buildClearedSessionCookie() {
  return clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: secureCookies ? "Strict" : "Lax",
    secure: secureCookies,
  });
}

class SessionService {
  async createSession(userId: string, ip?: string) {
    const sessionToken = createOpaqueToken(48);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

    const session = await prisma.authSession.create({
      data: {
        expiresAt,
        lastSeenAt: now,
        sessionToken,
        userId,
        ip,
      },
    });

    await appQueue.add("session-cleanup", { userId });

    if (ip) {
      await appQueue.add("update-session-location", {
        sessionId: session.id,
        ip,
      });
    }

    return session;
  }

  async getSession(sessionToken: string) {
    const session = await prisma.authSession.findUnique({
      where: { sessionToken },
      include: {
        user: true,
      },
    });

    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.authSession
        .delete({ where: { id: session.id } })
        .catch(() => null);
      return null;
    }

    const refreshed = await prisma.authSession.update({
      where: { id: session.id },
      data: {
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        lastSeenAt: new Date(),
      },
      include: {
        user: true,
      },
    });

    return refreshed;
  }

  async revokeSession(sessionToken: string) {
    await prisma.authSession.deleteMany({
      where: { sessionToken },
    });
  }

  writeSessionCookie(res: Response, sessionToken: string, expiresAt: Date) {
    appendSetCookie(res, buildSessionCookie(sessionToken, expiresAt));
  }

  clearSessionCookie(res: Response) {
    appendSetCookie(res, buildClearedSessionCookie());
  }
}

function toDashboardUser(user: User, session?: AuthSession) {
  return {
    id: user.id,
    name: user.name,
    photoUrl: user.photoUrl,
    telegramId: user.telegramId,
    username: user.username,
    location: session?.location,
  };
}

export { SessionService, SESSION_COOKIE_NAME, toDashboardUser };
