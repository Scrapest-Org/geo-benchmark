import type { Request, Response } from "express";
import { parse } from "valibot";
import { UrlSchema } from "../utils/valibot";
import { redis } from "@scrapest/config";
import { handleError } from "../utils/express";
import { KEYS } from "@scrapest/constants";
import { prisma } from "../services/prisma";

export class WebhookController {
  public registerWebhook = async (req: Request, res: Response) => {
    try {
      const apiKey = (req as any).apiKey;
      const { url, name } = req.body;

      if (!url) throw new Error("Missing 'url' in request body");
      if (!apiKey) throw new Error("Missing API key");

      const webhookUrl = parse(UrlSchema, url);

      const exists = await prisma.webhook.findFirst({
        where: { apiKey: apiKey },
        select: { id: true },
      });

      await Promise.all([
        redis.set(`${KEYS.WEBHOOK}:${apiKey}`, webhookUrl),
        exists
          ? prisma.webhook.update({
              where: { id: exists.id },
              data: { url: webhookUrl, status: "ACTIVE" },
            })
          : prisma.webhook.create({
              data: {
                apiKey: apiKey,
                name: name || "default",
                url: webhookUrl,
                status: "ACTIVE",
              },
            }),
      ]);

      const isUpdate = !!exists;
      return res.status(200).json({
        message: isUpdate
          ? "Webhook updated and tracking synced"
          : "Webhook registered successfully",
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public getWebhook = async (req: Request, res: Response) => {
    try {
      const apiKey = (req as any).apiKey;
      if (!apiKey) throw new Error("Missing API key");

      const webhook = await prisma.webhook.findFirst({
        where: { apiKey: apiKey },
      });

      return res.status(200).json({
        data: webhook,
        message: webhook
          ? "Webhook retrieved successfully"
          : "No webhook found for this API key",
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public deleteWebhook = async (req: Request, res: Response) => {
    try {
      const apiKey = (req as any).apiKey;
      if (!apiKey) throw new Error("Missing API key");

      const dbWebhook = await prisma.webhook.findFirst({
        where: { apiKey: apiKey },
        select: { id: true },
      });

      if (!dbWebhook) {
        return res.status(200).json({ message: "No webhook found to delete" });
      }

      await Promise.all([
        redis.del(`${KEYS.WEBHOOK}:${apiKey}`),
        prisma.webhook.delete({ where: { id: dbWebhook.id } }),
      ]);

      return res.status(200).json({ message: "Webhook deleted successfully" });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public updateWebhook = async (req: Request, res: Response) => {
    try {
      const apiKey = (req as any).apiKey;
      const { url } = req.body;

      if (!url) throw new Error("Missing 'url' in request body");
      if (!apiKey) throw new Error("Missing API key");

      const webhookUrl = parse(UrlSchema, url);

      const exists = await prisma.webhook.findFirst({
        where: { apiKey: apiKey },
        select: { id: true },
      });

      if (!exists) {
        return res
          .status(404)
          .json({ message: "No existing webhook found to update" });
      }

      await Promise.all([
        prisma.webhook.update({
          where: { id: exists.id },
          data: { url: webhookUrl, status: "ACTIVE" },
        }),
        redis.set(`${KEYS.WEBHOOK}:${apiKey}`, webhookUrl),
      ]);

      return res.status(200).json({ message: "Webhook updated successfully" });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public getWebhooks = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }

      const apikeys = await prisma.apiKey.findMany({
        where: { userId: req.user.id },
        select: {
          key: true,
          id: true,
          name: true,
          webhooks: {
            select: {
              id: true,
              name: true,
              url: true,
              status: true,
            },
          },
        },
      });

      const webhooks = apikeys
        .filter((apikey) => apikey.webhooks.length > 0)
        .map(({ webhooks, ...apikey }) => ({
          ...webhooks[0],
          apiKey: apikey,
        }));

      return res
        .status(200)
        .json({ data: webhooks, message: "Webhooks retrieved successfully" });
    } catch (error) {
      return handleError(res, error);
    }
  };
}
