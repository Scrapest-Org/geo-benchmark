import { Router } from "express";
import { AppService } from "../services/app";
import {
  requireApiKey,
  requireAdminKey,
  requireAnyKey,
  requireSession,
} from "../middleware/auth";
import { initSSE } from "../middleware/sse";
import { InternalsController } from "../controllers/internal.controller";
import { MetricsController } from "../controllers/metrics.controller";
import { TrackingController } from "../controllers/tracking.controller";
import { StreamController } from "../controllers/stream.controller";

const router = Router();
const app = new AppService();

const internalController = new InternalsController(app);
const metricsController = new MetricsController(app);
const trackingController = new TrackingController(app);
const streamController = new StreamController();

router.post("/track", requireApiKey, trackingController.track);
router.delete("/track", requireApiKey, trackingController.untrack);

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

export { router, app };
