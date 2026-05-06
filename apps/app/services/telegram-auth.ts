import { createHash, createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "@scrapest/config";
import { prisma } from "./prisma";
import { APP_URL } from "@scrapest/constants";

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 10 * 60;
const DASHBOARD_URL = getEnv("DASHBOARD_URL");
type TelegramLoginPayload = {
  auth_date: string;
  first_name: string;
  hash: string;
  id: string;
  last_name?: string;
  photo_url?: string;
  username?: string;
};

class TelegramAuthService {
  private readonly botUsername = "scrapest_bot";
  private readonly botToken = getEnv("BOT_TOKEN");

  getDashboardLoginUrl() {
    return `${DASHBOARD_URL}/login`;
  }

  getHostedAuthUrl() {
    return `${APP_URL}/auth/telegram/start`;
  }

  getWidgetCallbackUrl() {
    return `${APP_URL}/auth/telegram/callback`;
  }

  renderHostedAuthPage() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scrapest Telegram Login</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, system-ui, sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 32%),
          radial-gradient(circle at bottom right, rgba(8, 145, 178, 0.15), transparent 34%),
          #09090b;
        color: #f4f4f5;
      }

      .shell {
        width: min(100%, 420px);
        margin: 24px;
        padding: 32px;
        border: 1px solid rgba(63, 63, 70, 0.8);
        border-radius: 24px;
        background: rgba(24, 24, 27, 0.82);
        backdrop-filter: blur(18px);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        text-align: center;
      }

      .eyebrow {
        margin: 0 0 12px;
        font-size: 11px;
        letter-spacing: 0.32em;
        text-transform: uppercase;
        color: #71717a;
      }

      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.15;
      }

      p {
        margin: 0;
        color: #a1a1aa;
        line-height: 1.65;
      }

      .widget {
        display: flex;
        justify-content: center;
        margin: 28px 0 20px;
      }

      .hint {
        margin-top: 18px;
        font-size: 13px;
        color: #94a3b8;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <p class="eyebrow">Telegram Login</p>
      <h1>Continue with Telegram</h1>
      <p>Sign in with @${this.botUsername} to finish your Scrapest dashboard session.</p>
      <div class="widget">
        <script
          async
          src="https://telegram.org/js/telegram-widget.js?23"
          data-telegram-login="${this.botUsername}"
          data-size="large"
          data-request-access="write"
          data-auth-url="${this.getWidgetCallbackUrl()}"
        ></script>
      </div>
      <p class="hint">After Telegram verifies you, we’ll send you straight back to the dashboard.</p>
    </main>
  </body>
</html>`;
  }

  parseLoginPayload(input: Record<string, unknown>) {
    const payload: TelegramLoginPayload = {
      auth_date: this.requireString(input.auth_date, "auth_date"),
      first_name: this.requireString(input.first_name, "first_name"),
      hash: this.requireString(input.hash, "hash"),
      id: this.requireString(input.id, "id"),
    };

    const lastName = this.optionalString(input.last_name);
    const photoUrl = this.optionalString(input.photo_url);
    const username = this.optionalString(input.username);

    if (lastName) {
      payload.last_name = lastName;
    }

    if (photoUrl) {
      payload.photo_url = photoUrl;
    }

    if (username) {
      payload.username = username;
    }

    return payload;
  }

  verifyLogin(payload: TelegramLoginPayload) {
    const authDate = Number.parseInt(payload.auth_date, 10);

    if (!Number.isFinite(authDate)) {
      throw new Error("Invalid Telegram auth_date.");
    }

    if (!/^[a-f0-9]{64}$/i.test(payload.hash)) {
      throw new Error("Invalid Telegram hash.");
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds < 0 || ageSeconds > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
      throw new Error("Telegram login data has expired.");
    }

    const secretKey = createHash("sha256")
      .update(this.botToken, "utf8")
      .digest();
    const dataCheckString = this.buildDataCheckString(payload);
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString, "utf8")
      .digest();
    const actualHash = Buffer.from(payload.hash, "hex");

    if (
      actualHash.length !== expectedHash.length ||
      !timingSafeEqual(actualHash, expectedHash)
    ) {
      throw new Error("Telegram login payload failed verification.");
    }
  }

  async upsertUser(payload: TelegramLoginPayload) {
    const now = new Date();
    const name = [payload.first_name, payload.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    return await prisma.user.upsert({
      where: {
        telegramId: payload.id,
      },
      create: {
        lastAuthenticatedAt: now,
        name: name || payload.username || `Telegram ${payload.id}`,
        photoUrl: payload.photo_url ?? null,
        telegramId: payload.id,
        username: payload.username ?? null,
      },
      update: {
        lastAuthenticatedAt: now,
        name: name || payload.username || `Telegram ${payload.id}`,
        photoUrl: payload.photo_url ?? null,
        username: payload.username ?? null,
      },
    });
  }

  getSuccessRedirect() {
    return `${DASHBOARD_URL}/auth/callback?status=success`;
  }

  getFailureRedirect(reason = "telegram_auth") {
    return `${DASHBOARD_URL}/login?error=${encodeURIComponent(reason)}`;
  }

  private buildDataCheckString(payload: TelegramLoginPayload) {
    return Object.entries(payload)
      .filter(([key, value]) => key !== "hash" && value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  }

  private optionalString(value: unknown) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }

    return undefined;
  }

  private requireString(value: unknown, field: string) {
    const parsed = this.optionalString(value);

    if (!parsed) {
      throw new Error(`Missing Telegram ${field}.`);
    }

    return parsed;
  }
}

export { TelegramAuthService, DASHBOARD_URL };
