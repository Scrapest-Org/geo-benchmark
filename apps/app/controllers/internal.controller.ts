import type { Request, Response } from "express";
import type { AppService } from "../services/app";
import { handleError } from "../utils/express";
import { AccountPoolManager, type Account } from "@scrapest/core";
import { prisma } from "../services/prisma";
import { InternalService } from "../services/internal";
import { BackfillRequestSchema, FinalizeTrackSchema } from "../utils/valibot";
import { parse } from "valibot";
import { DiscordTracking, TelegramTracking } from "../services/tracking";
import { appQueue } from "../utils/queues";

export class InternalsController {
  private readonly internal: InternalService;

  private readonly telegram: TelegramTracking;
  private readonly discord: DiscordTracking;

  constructor(app: AppService) {
    this.internal = new InternalService();

    this.discord = new DiscordTracking();
    this.telegram = new TelegramTracking();
  }

  public dispatch = async (req: Request, res: Response) => {
    try {
      const { payload } = req.body;
      if (!payload) throw new Error("No payload provided");

      this.internal.handleDispatch(payload);

      return res.status(200).send(`Received ${payload.length} event(s)`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  public getAllSources = async (_req: Request, res: Response) => {
    try {
      const sources = await prisma.sourceInfo.findMany({
        where: {
          source: "X",
        },
        select: {
          username: true,
          externalId: true,
          name: true,
        },
      });

      const data = sources.map((u) => ({
        name: u.name!,
        username: u.username!,
        id: u.externalId,
      }));
      return res.status(200).json(data);
    } catch (error) {
      return handleError(res, error);
    }
  };

  public finalizeTrack = async (req: Request, res: Response) => {
    try {
      const { apiKey, externalId, data, source } = parse(
        FinalizeTrackSchema,
        req.body,
      );
      const tracker = source === "telegram" ? this.telegram : this.discord;

      const result = await tracker._track(apiKey, externalId, {
        name: data.name ?? null,
        username: data.username ?? null,
      });

      await appQueue.add("track-source", { data: result, apiKey });

      return res.status(200).json({
        message: `${source} source ${result.name ?? result.externalId} finalized`,
        data: result,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };
}
