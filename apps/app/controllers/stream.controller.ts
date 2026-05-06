import type { Request, Response } from "express";
import crypto from "crypto";
import { redis } from "@scrapest/config";
import {
  SSE_PUBLIC_AUTH,
  SSE_TOKEN_KEY,
  SSERegistry,
  type SSEClient,
} from "../services/ws";

export class StreamController {
  private readonly SSE_APIKEY_KEY = (apiKey: string) => `sse:apikey:${apiKey}`;

  async generateToken(req: Request, res: Response) {
    try {
      const apiKey = (req as any).auth.apiKey;
      const existing = await redis.get(this.SSE_APIKEY_KEY(apiKey));

      if (existing) {
        const ttl = await redis.ttl(SSE_TOKEN_KEY(existing));
        if (ttl > 0) {
          return res.json({ token: existing, expiresIn: ttl });
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiry = 86400;

      await redis
        .pipeline()
        .setex(SSE_TOKEN_KEY(token), expiry, apiKey)
        .setex(this.SSE_APIKEY_KEY(apiKey), expiry, token)
        .exec();

      return res.json({ token, expiresIn: expiry });
    } catch (error) {
      console.error("Error generating SSE token:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  stream(req: Request, res: Response) {
    const useFastX = req.query.useFastX === "true";
    const ignoreFullPayload = req.query.ignoreFullPayload === "true";
    const auth = req.sse?.apiKey || SSE_PUBLIC_AUTH;
    if (!auth) {
      return res
        .status(401)
        .send("Unauthorized: Invalid or expired stream token");
    }

    const client: SSEClient = {
      auth,
      connectedAt: Date.now(),
      send: (data: string) => {
        res.write(data);
      },
      useFastX,
      ignoreFullPayload,
    };

    SSERegistry.add(client);

    req.on("close", () => {
      SSERegistry.remove(client);
      res.end();
    });
  }
}
