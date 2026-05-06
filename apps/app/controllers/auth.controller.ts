import type { Request, Response } from "express";
import { parseCookies } from "../utils/http";
import { SessionService, toDashboardUser } from "../services/session";
import { TelegramAuthService } from "../services/telegram-auth";
import { handleError } from "../utils/express";

const telegramAuthService = new TelegramAuthService();
const sessionService = new SessionService();

export class AuthController {
  static async handleTelegramCallback(req: Request, res: Response) {
    try {
      const loginPayload = telegramAuthService.parseLoginPayload(
        req.query as Record<string, unknown>,
      );

      telegramAuthService.verifyLogin(loginPayload);
      const user = await telegramAuthService.upsertUser(loginPayload);
      const session = await sessionService.createSession(user.id, req.ip);

      sessionService.writeSessionCookie(
        res,
        session.sessionToken,
        session.expiresAt,
      );

      return res.redirect(telegramAuthService.getSuccessRedirect());
    } catch (error) {
      console.error("Telegram callback error:", error);
      return res.redirect(telegramAuthService.getFailureRedirect());
    }
  }

  static async me(req: Request, res: Response) {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }

      return res.status(200).json({
        data: toDashboardUser(req.user, req.session),
        message: `Authenticated as ${req.user.name}.`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  }

  static async logout(req: Request, res: Response) {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const sessionToken = cookies["scrapest_session"];

      if (sessionToken) {
        await sessionService.revokeSession(sessionToken);
      }

      sessionService.clearSessionCookie(res);
      return res.status(200).json({
        message: "Logged out successfully.",
        data: null,
      });
    } catch (error) {
      return handleError(res, error);
    }
  }
}
