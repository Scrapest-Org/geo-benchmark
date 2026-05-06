import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { WebhookController } from "../controllers/webhook.controller";
import { ApiKeyController } from "../controllers/api-key.controller";
import { AppService } from "../services/app";
import {
  requireApiKey,
  requireAdminKey,
  requireAnyKey,
  requireSession,
} from "../middleware/auth";
import { initSSE } from "../middleware/sse";
import { XController } from "../controllers/x.controller";
import { InternalsController } from "../controllers/internal.controller";
import { MetricsController } from "../controllers/metrics.controller";
import { rateLimit } from "../middleware/rate-limit";
import { TrackingController } from "../controllers/tracking.controller";
import { StreamController } from "../controllers/stream.controller";
import { BackfillController } from "../controllers/backfill.controller";
import { TelegramController } from "../controllers/telegram.controller";

const router = Router();
const app = new AppService();

const xController = new XController(app);
const internalController = new InternalsController(app);
const metricsController = new MetricsController(app);
const trackingController = new TrackingController(app);
const webhookController = new WebhookController();
const apiKeyController = new ApiKeyController();
const streamController = new StreamController();
const backfillController = new BackfillController();

// Auth routes
router.get("/auth/telegram/callback", AuthController.handleTelegramCallback);
router.get("/auth/me", requireSession, AuthController.me);
router.post("/auth/logout", requireSession, AuthController.logout);

// Dashboard API key routes
router.get("/api-keys", requireSession, apiKeyController.list);
router.post("/api-keys", requireSession, apiKeyController.create);
router.post("/api-keys/claim", requireSession, apiKeyController.claim);
router.patch("/api-keys/:id", requireSession, apiKeyController.rename);
router.delete("/api-keys/:id", requireSession, apiKeyController.remove);

// Webhook routes
router.post("/webhook", requireApiKey, webhookController.registerWebhook);
router.get("/webhook", requireApiKey, webhookController.getWebhook);
router.get("/webhooks", requireSession, webhookController.getWebhooks);
router.delete("/webhook", requireApiKey, webhookController.deleteWebhook);
router.patch("/webhook", requireApiKey, webhookController.updateWebhook);

// Tracking routes
router.get("/tracked-sources", requireSession, trackingController.listForUser);
router.get(
  "/track/status/:source/:jobId",
  requireApiKey,
  trackingController.trackStatus,
);
router.get("/track/:source/find", requireAnyKey, trackingController.find);
router.post("/track/:source", requireApiKey, trackingController.track);
router.delete("/track/:source", requireApiKey, trackingController.untrack);
router.get("/track/:source", requireApiKey, trackingController.list);
router.get(
  "/track/:source/info",
  requireApiKey,
  trackingController.getTrackedSource,
);

// X routes (Public/Private combined)
router.get("/x/user", requireAnyKey, rateLimit(10, 60), xController.getUser);
router.get("/x/post", requireAnyKey, rateLimit(10, 60), xController.getPost);
router.get("/x/tweet", requireAnyKey, rateLimit(10, 60), xController.getPost); // Alias
router.get(
  "/x/search",
  requireAnyKey,
  rateLimit(10, 60),
  xController.searchPosts,
);
router.get(
  "/x/quick-search",
  requireAnyKey,
  rateLimit(10, 60),
  xController.quickSearch,
);

// Telegram routes
router.get(
  "/telegram/search",
  requireAnyKey,
  rateLimit(10, 60),
  telegramController.searchGlobal,
);
router.get(
  "/telegram/users/search",
  requireAnyKey,
  rateLimit(10, 60),
  telegramController.searchUsers,
);
router.get(
  "/telegram/channel/:channelId/search",
  requireAnyKey,
  rateLimit(10, 60),
  telegramController.searchChannel,
);
router.get(
  "/telegram/channel/:channelId/participants/search",
  requireAnyKey,
  rateLimit(10, 60),
  telegramController.searchParticipants,
);
router.get(
  "/telegram/channel/:channelId/type/:type/search",
  requireAnyKey,
  rateLimit(10, 60),
  telegramController.searchChannelByType,
);
router.get(
  "/telegram/media/:channelId/:messageId",
  rateLimit(2, 60),
  telegramController.downloadMedia,
);

// Account history routes (read backfilled data)
router.get(
  "/backfill-view",
  requireSession,
  backfillController.dashboardBackfill,
);
router.get(
  "/account/history/:id",
  requireApiKey,
  rateLimit(30, 60),
  backfillController.apiBackfill,
);

// Backfill operation routes (trigger / status)
router.put(
  "/backfill",
  requireApiKey,
  rateLimit(5, 60),
  backfillController.triggerBackfill,
);
router.get(
  "/backfill/status",
  requireApiKey,
  rateLimit(6, 60),
  backfillController.backfillStatus,
);
router.get(
  "/mentions",
  requireApiKey,
  rateLimit(30, 60),
  backfillController.getMentions,
);

// Internal routes
router.post("/internal/dispatch", requireAdminKey, internalController.dispatch);
router.get("/internal/sources", internalController.getAllSources);
router.post("/internal/track", internalController.finalizeTrack);
// Health routes
router.get("/health", metricsController.health);
router.get("/health/status", metricsController.healthStatus);
router.get("/metrics", metricsController.metrics);
router.get("/metrics/:source", metricsController.metricsBySource);

// Stream Server-Sent Events Route
router.post("/stream/token", requireAnyKey, streamController.generateToken);
router.get("/stream", initSSE, streamController.stream);

export { router, app, tg_client };
