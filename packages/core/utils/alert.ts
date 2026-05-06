import TelegramBot from "node-telegram-bot-api";
import { getEnvOrNull } from "@scrapest/config";

type AlertLevel = "info" | "warn" | "error" | "critical";

interface AlertOptions {
  level?: AlertLevel;
  instanceId?: string;
}

let bot: TelegramBot | null = null;
let adminChatId: string | null = null;
let initialized = false;

function getBot(): TelegramBot | null {
  const token = getEnvOrNull("BOT_TOKEN");
  if (!token) return null;

  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

function getAdminChatId(): string | null {
  if (!adminChatId) {
    adminChatId = getEnvOrNull("ADMIN_CHAT_ID");
  }
  return adminChatId;
}

function formatMessage(
  level: AlertLevel,
  message: string,
  instanceId?: string,
): string {
  const timestamp = new Date().toISOString();
  const levelIcon = {
    info: "ℹ️",
    warn: "⚠️",
    error: "❌",
    critical: "🚨",
  }[level];

  const instance = instanceId ? `\nInstance: \`${instanceId}\`` : "";
  return `${levelIcon} <b>[${level.toUpperCase()}]</b> ${timestamp}${instance}\n${message}`;
}

async function send(message: string): Promise<boolean> {
  const tg = getBot();
  const chatId = getAdminChatId();

  if (!tg || !chatId) {
    console.warn("TG Alert: Bot or chat ID not configured");
    return false;
  }

  try {
    await tg.sendMessage(chatId, message, { parse_mode: "HTML" });
    return true;
  } catch (error) {
    console.error("Failed to send TG alert:", error);
    return false;
  }
}

export const alert = {
  async send(message: string, options: AlertOptions = {}): Promise<boolean> {
    const { level = "info", instanceId } = options;
    const formatted = formatMessage(level, message, instanceId);
    return send(formatted);
  },

  async info(message: string, instanceId?: string): Promise<boolean> {
    return this.send(message, { level: "info", instanceId });
  },

  async warn(message: string, instanceId?: string): Promise<boolean> {
    return this.send(message, { level: "warn", instanceId });
  },

  async error(message: string, instanceId?: string): Promise<boolean> {
    return this.send(message, { level: "error", instanceId });
  },

  async critical(message: string, instanceId?: string): Promise<boolean> {
    return this.send(message, { level: "critical", instanceId });
  },

  async webpushIssue(
    issue:
      | "connection_drop"
      | "stale_connection"
      | "decrypt_fail"
      | "high_latency"
      | "account_rotated",
    details: {
      instanceId: string;
      latencyMs?: number;
      retryCount?: number;
      errorMessage?: string;
    },
  ): Promise<boolean> {
    const messages = {
      connection_drop: `🔌 WebSocket disconnected and reconnecting\nRetry: ${details.retryCount ?? 0}`,
      stale_connection: `📡 WebSocket connection appears stale\nNo notifications received for extended period`,
      decrypt_fail: `🔓 Failed to decrypt notification\n${details.errorMessage ?? "Unknown error"}`,
      high_latency: `⏱️ High latency detected\nLatency: ${details.latencyMs ?? 0}ms`,
      account_rotated: `🔄 Account rotated\nNew session being established`,
    };

    return this.error(messages[issue], details.instanceId);
  },
};
