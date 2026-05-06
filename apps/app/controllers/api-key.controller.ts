import type { Request, Response } from "express";
import { parse } from "valibot";
import { ApiKeyService } from "../services/api-keys";
import { handleError } from "../utils/express";
import { ApiKeyNameSchema } from "../utils/valibot";
import { appQueue } from "../utils/queues";

const apiKeyService = new ApiKeyService();

export class ApiKeyController {
  public list = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }

      const apiKeys = await apiKeyService.listForUser(req.user.id);
      return res
        .status(200)
        .json({ data: apiKeys, message: "API keys retrieved successfully." });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public create = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }

      const name = parse(
        ApiKeyNameSchema,
        req.body?.name ?? `Key-${Date.now()}`,
      );
      const result = await apiKeyService.createForUser(req.user.id, name);

      return res.status(201).json({
        data: result,
        message: `API key created successfully. You can proceed with making requests by selecting ${name} in the dropdown.`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public rename = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }
      const apiKeyId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      if (!apiKeyId) {
        throw new Error("Missing API key id.");
      }

      const name = parse(ApiKeyNameSchema, req.body?.name);
      await apiKeyService.renameForUser(req.user.id, apiKeyId, name);

      return res.status(200).json({
        data: null,
        message: "API key renamed successfully.",
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public claim = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }

      const key = req.body?.key;
      if (!key || typeof key !== "string") {
        throw new Error("Missing 'key' in request body.");
      }

      const name = parse(
        ApiKeyNameSchema,
        req.body?.name ?? `Key-${Date.now()}`,
      );

      const result = await apiKeyService.claimForUser(req.user.id, key, name);

      await appQueue.add("claim-key", { apiKey: key });

      return res.status(201).json({
        data: result,
        message: `API key claimed as "${name}". Your tracked sources and webhook are being imported.`,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public remove = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("Missing authenticated user.");
      }
      const apiKeyId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      if (!apiKeyId) {
        throw new Error("Missing API key id.");
      }

      await apiKeyService.deleteForUser(req.user.id, apiKeyId);

      return res.status(200).json({
        message: "API key deleted successfully.",
        data: null,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };
}
