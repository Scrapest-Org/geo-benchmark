import type { Request, Response } from "express";
import { parse } from "valibot";
import {
  BackfillDashboardQuerySchema,
  BackfillApiQuerySchema,
  TriggerBackfillSchema,
  MentionsQuerySchema,
} from "../utils/valibot";
import { handleError } from "../utils/express";
import { prisma } from "../services/prisma";
import { redis } from "@scrapest/config";
import { backfillQueue } from "../utils/queues";

export class BackfillController {
  constructor() {}
  public dashboardBackfill = async (req: Request, res: Response) => {
    try {
      const query = parse(BackfillDashboardQuerySchema, req.query);

      const page = query.page ?? 1;
      const limit = query.limit ?? 25;
      const offset = (page - 1) * limit;
      const order = query.order ?? "desc";

      const values: any[] = [];
      const conditions: string[] = [];

      if (query.source) {
        values.push(query.source);
        conditions.push(`bd.source = $${values.length}::"TrackedSource"`);
      }

      if (query.sourceId) {
        values.push(query.sourceId);
        conditions.push(`bd."sourceId" = $${values.length}`);
      }

      if (query.messageId) {
        values.push(query.messageId);
        conditions.push(`bd."messageId" = $${values.length}`);
      }

      if (query.startDate) {
        values.push(new Date(query.startDate));
        conditions.push(`bd."createdAt" >= $${values.length}`);
      }

      if (query.endDate) {
        values.push(new Date(query.endDate));
        conditions.push(`bd."createdAt" <= $${values.length}`);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const dataValues = [...values, limit, offset];

      const data = await prisma.$queryRawUnsafe(
        `
        SELECT
          bd.id,
          bd.source,
          bd."messageId",
          bd."sourceId",
          bd.content,
          bd."createdAt",
          json_build_object(
            'id', si.id,
            'username', si.username,
            'name', si.name,
            'externalId', si."externalId"
          ) AS "sourceInfo"
        FROM "BackfillData" bd
        JOIN "SourceInfo" si ON si.source = bd.source AND si."externalId" = bd."sourceId"
        ${where}
        ORDER BY bd."createdAt" ${order === "asc" ? "ASC" : "DESC"}
        LIMIT $${dataValues.length - 1}
        OFFSET $${dataValues.length}
        `,
        ...dataValues,
      );

      const countResult = (await prisma.$queryRawUnsafe(
        `
        SELECT COUNT(*) AS total
        FROM "BackfillData" bd
        JOIN "SourceInfo" si ON si.source = bd.source AND si."externalId" = bd."sourceId"
        ${where}
        `,
        ...values,
      )) as { total: bigint }[];

      const total = Number(countResult[0]?.total ?? 0);

      return res.status(200).json({
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public apiBackfill = async (req: Request, res: Response) => {
    try {
      const { id } = parse(TriggerBackfillSchema, req.params);
      const sourceInfo = await prisma.sourceInfo.findUnique({
        where: { id },
        select: { externalId: true, source: true },
      });

      if (!sourceInfo) {
        return res.status(404).json({
          status: "not_found",
          error: "Source not found for the given internal ID.",
        });
      }

      const { externalId, source } = sourceInfo;
      const query = parse(BackfillApiQuerySchema, req.query);

      const limit = query.limit ?? 50;
      const order = query.order ?? "desc";

      const values: any[] = [];
      const conditions: string[] = [];

      values.push(source);
      conditions.push(`bd.source = $${values.length}::"TrackedSource"`);

      values.push(externalId);
      conditions.push(`bd."sourceId" = $${values.length}`);

      if (query.messageId) {
        values.push(query.messageId);
        conditions.push(`bd."messageId" = $${values.length}`);
      }

      if (query.startDate) {
        values.push(new Date(query.startDate));
        conditions.push(`bd."createdAt" >= $${values.length}`);
      }

      if (query.endDate) {
        values.push(new Date(query.endDate));
        conditions.push(`bd."createdAt" <= $${values.length}`);
      }

      if (query.cursor) {
        values.push(query.cursor);
        const op = order === "desc" ? "<" : ">";
        conditions.push(
          `bd."createdAt" ${op} (SELECT "createdAt" FROM "BackfillData" WHERE id = $${values.length})`,
        );
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      values.push(limit);

      const data = (await prisma.$queryRawUnsafe(
        `
        SELECT
          bd.id,
          bd.source,
          bd."messageId",
          bd."sourceId",
          bd.content,
          bd."rawPayload",
          bd."createdAt"
        FROM "BackfillData" bd
        ${where}
        ORDER BY bd."createdAt" ${order === "asc" ? "ASC" : "DESC"}
        LIMIT $${values.length}
        `,
        ...values,
      )) as any[];

      // Auto-backfill: if no data, enqueue a job
      if (data.length === 0 && query.autoBackfill === "true") {
        const src = source.toLowerCase();
        const redisKey = `historical-backfill-${src}:${externalId}`;

        const alreadyRunning = await redis.hget(redisKey, "cursor");

        if (!alreadyRunning || alreadyRunning === "done") {
          await backfillQueue.add(
            `${src}-historical-backfill`,
            { eid: externalId },
            {
              jobId: `${src}-historical_${externalId}`,
              priority: 0,
            },
          );
        }

        return res.status(200).json({
          data: [],
          nextCursor: null,
          limit,
          backfillTriggered: true,
        });
      }

      const nextCursor =
        data.length === limit ? data[data.length - 1].id : null;

      return res.status(200).json({
        data,
        nextCursor,
        limit,
        backfillTriggered: false,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public triggerBackfill = async (req: Request, res: Response) => {
    try {
      const { id } = parse(TriggerBackfillSchema, req.body);

      const sourceInfo = await prisma.sourceInfo.findUnique({
        where: { id },
        select: {
          externalId: true,
          source: true,
        },
      });

      if (!sourceInfo) {
        return res.status(404).json({
          status: "not_found",
          error: "Source not found for the given internal ID.",
        });
      }

      const { externalId, source: dbSource } = sourceInfo;
      const source = dbSource === "X" ? "x" : "telegram";

      if (dbSource !== "X" && dbSource !== "TELEGRAM") {
        return res.status(400).json({
          status: "error",
          error:
            "Invalid source. Only X and Telegram are supported for backfills.",
        });
      }

      console.log(
        `[Backfill] Resolved internal ID ${id} → externalId: ${externalId} (${source})`,
      );

      const redisKey = `historical-backfill-${source}:${externalId}`;

      const existing = await redis.hgetall(redisKey);
      if (existing?.cursor && existing.cursor !== "done") {
        return res.status(409).json({
          status: "conflict",
          error: "A backfill is already in progress for this source.",
          progress: {
            cursor: existing.cursor,
            last_id: existing.last_id ?? null,
            total: existing.total ?? null,
            updated_at: existing.updated_at
              ? new Date(Number(existing.updated_at)).toISOString()
              : null,
          },
        });
      }

      await redis.del(redisKey);

      const cursor = existing?.cursor !== "done" ? existing?.cursor : undefined;
      await backfillQueue.add(
        `${source}-historical-backfill`,
        { eid: externalId, cursor },
        {
          jobId: `${source}-historical_${externalId}_${Date.now()}`,
          priority: 0,
        },
      );

      return res.status(202).json({
        status: "queued",
        id,
        externalId,
        source,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * GET /backfill/status — Check backfill progress for an account.
   * Reads from Redis historical-backfill-x:{sourceId}.
   */
  public backfillStatus = async (req: Request, res: Response) => {
    try {
      const { id } = parse(TriggerBackfillSchema, req.query);

      const sourceInfo = await prisma.sourceInfo.findUnique({
        where: { id },
      });

      if (!sourceInfo) {
        return res.status(404).json({
          status: "not_found",
          error: "Source not found for the given internal ID.",
        });
      }

      const { externalId, source: dbSource } = sourceInfo;
      const source = dbSource === "TELEGRAM" ? "telegram" : "x";

      console.log(
        `[Backfill] Status check — resolved internal ID ${id} → externalId: ${externalId} (${source})`,
      );

      const redisKey = `historical-backfill-${source}:${externalId}`;
      const state = await redis.hgetall(redisKey);

      if (!state || Object.keys(state).length === 0) {
        return res.status(200).json({
          status: "not_started",
          id,
          externalId,
        });
      }

      const isComplete = state.cursor === "done";

      return res.status(200).json({
        status: isComplete ? "complete" : "in_progress",
        id,
        externalId,
        cursor: state.cursor ?? null,
        last_id: state.last_id ?? null,
        total: state.total ?? null,
        updated_at: state.updated_at
          ? new Date(Number(state.updated_at)).toISOString()
          : null,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * GET /mentions — Search backfill data for specific token mentions (ticker or contract address)
   */
  public getMentions = async (req: Request, res: Response) => {
    try {
      const query = parse(MentionsQuerySchema, req.query);

      if (!query.ticker && !query.contractAddress) {
        return res.status(400).json({
          status: "error",
          error:
            "At least one of 'ticker' or 'contractAddress' must be provided.",
        });
      }

      const limit = query.limit ?? 50;
      const order = query.order ?? "desc";

      const values: any[] = [];
      const conditions: string[] = [];

      if (query.source) {
        values.push(query.source);
        conditions.push(`bd.source = $${values.length}::"TrackedSource"`);
      }

      const searchConditions = [];
      if (query.ticker) {
        values.push(`%${query.ticker}%`);
        searchConditions.push(`bd.content ILIKE $${values.length}`);
      }
      if (query.contractAddress) {
        values.push(`%${query.contractAddress}%`);
        searchConditions.push(`bd.content ILIKE $${values.length}`);
      }

      if (searchConditions.length > 0) {
        conditions.push(`(${searchConditions.join(" OR ")})`);
      }

      if (query.cursor) {
        values.push(query.cursor);
        const op = order === "desc" ? "<" : ">";
        conditions.push(
          `bd."createdAt" ${op} (SELECT "createdAt" FROM "BackfillData" WHERE id = $${values.length})`,
        );
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      values.push(limit);

      const data = (await prisma.$queryRawUnsafe(
        `
        SELECT
          bd.id,
          bd.source,
          bd."messageId",
          bd."sourceId",
          bd.content,
          bd."rawPayload",
          bd."createdAt"
        FROM "BackfillData" bd
        ${where}
        ORDER BY bd."createdAt" ${order === "asc" ? "ASC" : "DESC"}
        LIMIT $${values.length}
        `,
        ...values,
      )) as any[];

      const nextCursor =
        data.length === limit ? data[data.length - 1].id : null;

      return res.status(200).json({
        data,
        nextCursor,
        limit,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };
}
