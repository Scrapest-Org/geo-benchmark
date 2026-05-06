import type { Request, Response } from "express";
import { handleError } from "../utils/express";
import { parse } from "valibot";
import {
  SourceTypeSchema,
  GetTrackedSourceByIdSchema,
  FindTrackedSourceSchema,
  TrackStatusSourceSchema,
} from "../utils/valibot";
import { AppService } from "../services/app";
import { prisma } from "../services/prisma";
import type { TrackedSource } from "@scrapest/prisma";
import type { SourceType } from "@scrapest/core/lib/resolvers";
import {
  XTracking,
  DiscordTracking,
  TelegramTracking,
  type Tracking,
} from "../services/tracking";
import { appQueue } from "../utils/queues";
import type { SourceInfoWhereInput } from "packages/prisma/generated/prisma/models";

export class TrackingController {
  private readonly trackers: Record<SourceType, Tracking | null>;
  private readonly dbMapping: Record<SourceType, TrackedSource> = {
    x: "X",
    discord: "DISCORD",
    telegram: "TELEGRAM",
  };

  constructor(private readonly app: AppService) {
    this.trackers = {
      x: new XTracking(app),
      discord: new DiscordTracking(),
      telegram: new TelegramTracking(),
    };
  }

  public track = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const param = parse(SourceTypeSchema, req.params.source);
      const sid = req.body.sid as any;

      if (!sid) throw new Error("Missing 'source ID' in request body");
      if (!apiKey) throw new Error("Missing API key in request context");

      const tracker = this.trackers[param];
      if (!tracker)
        throw new Error(`No tracker implementation yet for ${param}`);

      const data = await tracker.track(apiKey, sid);

      if ("jobId" in data) {
        return res.status(202).json({
          message: `Tracking request for "${sid}" on ${param} has been queued`,
          jobId: data.jobId,
        });
      }

      await appQueue.add("track-source", { data, apiKey });

      return res.status(200).json({
        message: `Now tracking ${data.name ?? data.id} on ${param}`,
        data,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public untrack = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const param = parse(SourceTypeSchema, req.params.source);
      const id = parse(GetTrackedSourceByIdSchema, req.body);

      if (!apiKey) throw new Error("Missing API key in request context");

      const tracker = this.trackers[param];
      if (!tracker)
        throw new Error(`No tracker implementation yet for ${param}`);

      const data = await tracker.untrack(apiKey, id);

      return res.status(200).json({
        message: `Stopped tracking on ${param}`,
        data,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public find = async (req: Request, res: Response) => {
    try {
      const {
        query,
        page = 1,
        limit = 20,
      } = parse(FindTrackedSourceSchema, req.query);
      const param = parse(SourceTypeSchema, req.params.source);

      const where: SourceInfoWhereInput = {
        source: this.dbMapping[param],
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
        ],
      };

      const [data, total] = await Promise.all([
        prisma.sourceInfo.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { updatedAt: "desc" },
        }),
        prisma.sourceInfo.count({ where }),
      ]);

      return res.status(200).json({
        data,
        total,
        page,
        limit,
        message: `Found ${total} matching sources`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public listForUser = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(req.query.limit as string) || 20),
      );
      const source = req.query.source as string | undefined;
      const apiKeyId = req.query.apiKeyId as string | undefined;

      let mappedSource: string | undefined;
      if (source) {
        const validSource = parse(SourceTypeSchema, source);
        mappedSource = this.dbMapping[validSource];
      }

      const values: any[] = [userId];
      let where = `WHERE ak."userId" = $1`;

      if (apiKeyId) {
        values.push(apiKeyId);
        where += ` AND ak.id = $${values.length}`;
      }

      if (mappedSource) {
        values.push(mappedSource);
        where += ` AND s.source = $${values.length}`;
      }

      const dataValues = [...values];
      dataValues.push(limit);
      dataValues.push((page - 1) * limit);

      const data = await prisma.$queryRawUnsafe(
        `
      SELECT 
        s.id,
        s.source,
        s."externalId",
        s.username,
        s.name,
        json_agg(
          json_build_object(
            'id', ak.id,
            'name', ak.name,
            'key', ak.key
          )
        ) AS "apiKeys"
      FROM "TrackedSourceMapping" t
      JOIN "SourceInfo" s ON t."sourceInfoId" = s.id
      JOIN "ApiKey" ak ON t."apiKey" = ak.key
      ${where}
      GROUP BY s.id
      ORDER BY MAX(t."createdAt") DESC
      LIMIT $${dataValues.length - 1}
      OFFSET $${dataValues.length}
      `,
        ...dataValues,
      );
      const countResult = await prisma.$queryRawUnsafe(
        `
      SELECT COUNT(DISTINCT t."sourceInfoId") as total
      FROM "TrackedSourceMapping" t
      JOIN "ApiKey" ak ON t."apiKey" = ak.key
      JOIN "SourceInfo" s ON t."sourceInfoId" = s.id
      ${where}
      `,
        ...values,
      );

      const total = Number((countResult as any)[0]?.total || 0);

      return res.status(200).json({
        data,
        total,
        page,
        limit,
        message: `${total} tracked sources`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public list = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const param = parse(SourceTypeSchema, req.params.source);

      if (!apiKey) throw new Error("Missing API key in request context");

      const tracker = this.trackers[param];
      if (!tracker)
        throw new Error(`No tracker implementation yet for ${param}`);

      const sids = await tracker.getTracked(apiKey);
      if (sids.length === 0) {
        return res.status(200).json({
          data: [],
          message: `No sources are being tracked by this api key for ${param}`,
        });
      }

      const sources = await prisma.sourceInfo.findMany({
        where: {
          source: this.dbMapping[param],
          externalId: {
            in: sids,
          },
        },
        select: {
          name: true,
          username: true,
          id: true,
          externalId: true,
        },
      });

      return res.status(200).json({
        data: sources,
        message: `${sources.length} sources tracked on ${param}`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public getTrackedSource = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const query = parse(GetTrackedSourceByIdSchema, req.query);
      const param = parse(SourceTypeSchema, req.params.source);

      if (!apiKey) throw new Error("Missing API key in request context");

      const source = await prisma.sourceInfo.findUnique({
        where:
          "eid" in query
            ? {
                source_externalId: {
                  source: this.dbMapping[param],
                  externalId: query.eid,
                },
              }
            : { id: query.iid },
      });

      if (!source) {
        return res.status(404).json({ message: "Tracked source not found" });
      }

      return res.status(200).json({ data: source });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public trackStatus = async (req: Request, res: Response) => {
    try {
      const source = parse(TrackStatusSourceSchema, req.params.source);
      const jobId = req.params.jobId;
      if (!jobId || typeof jobId !== "string")
        throw new Error("Invalid job ID");

      const tracker = this.trackers[source];
      if (!tracker)
        throw new Error(`No tracker implementation for ${source}`);

      const status = await tracker.getJobStatus(jobId);
      if (!status) {
        return res.status(404).json({ message: "Job not found" });
      }

      return res.status(200).json(status);
    } catch (error) {
      return handleError(res, error);
    }
  };
}
