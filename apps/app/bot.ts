import TelegramBot from "node-telegram-bot-api";
import { getEnv } from "@scrapest/config";
import { app } from "./routes";
import { DASHBOARD_URL } from "./services/telegram-auth";

const BOT_TOKEN = getEnv("BOT_TOKEN");
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

bot.onText(/\/start(?:\s+.+)?/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `<b>Dashboard Login</b>\n\nAuthentication now happens through the dashboard.\nOpen <a href="${DASHBOARD_URL}/login">${DASHBOARD_URL}/login</a> to sign in with Telegram and manage your API keys.`,
      { parse_mode: "HTML" },
    );
  } catch (e) {
    console.error("Error occured in /start call", e);
  }
});

bot.onText(/\/getkey/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `🔑 API key management moved to the dashboard.\n\nVisit ${DASHBOARD_URL}/login to sign in and manage your keys.`,
    );
  } catch (e) {
    console.error("Error occured in /getkey call", e);
  }
});

bot.onText(/\/health/, async (msg) => {
  try {
    const chatId = msg.chat.id;

    try {
      const health = await app.health();

      const wsIcon = health.fleet.shards.length > 0 ? "🟢" : "🔴";
      const authIcon = health.fleet.shards.some((s) => s.x_authenticated)
        ? "🟢"
        : "🔴";
      const pushIcon = health.fleet.shards.some((s) => s.is_registered)
        ? "🟢"
        : "🔴";

      const message =
        `<b>Webpush System Health Status</b>\n\n` +
        `Service state: <b>${health.status}</b>\n` +
        `${wsIcon} WebSocket Connected: <b>${health.fleet.shards.length}</b>\n` +
        `${authIcon} X Auth: <b>${health.fleet.shards.filter((s) => s.x_authenticated).length}</b>\n` +
        `${pushIcon} Push Registered: <b>${health.fleet.shards.filter((s) => s.is_registered).length}</b>\n`;

      await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error) {
      await bot.sendMessage(chatId, "❌ Failed to retrieve health status.");
    }
  } catch (e) {
    console.error("Error occured in /health call", e);
  }
});

export { bot, BOT_TOKEN };
