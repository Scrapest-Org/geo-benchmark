import type { NextFunction, Request, Response } from "express";
import { redis } from "@scrapest/config";
import { SSE_TOKEN_KEY } from "../services/ws";

export const initSSE = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.query.token;
    if (token !== undefined) {
      if (typeof token !== "string" || token.length === 0) {
        return res
          .status(401)
          .send("Unauthorized: Invalid or expired stream token");
      }

      const authKey = await redis.get(SSE_TOKEN_KEY(token));
      if (!authKey) {
        return res
          .status(401)
          .send("Unauthorized: Invalid or expired stream token");
      }

      req.sse = { apiKey: authKey };
    } else {
      req.sse = {};
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    next();
  } catch (error) {
    console.error("SSE init error:", error);
    return res.status(500).send("Internal server error");
  }
};
