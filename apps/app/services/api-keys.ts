import { redis } from "@scrapest/config";
import { KEYS } from "@scrapest/constants";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";

const API_KEY_PREFIX = "pk_live_";

function generateRawApiKey() {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

class ApiKeyService {
  async listForUser(userId: string) {
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      omit: { userId: true, updatedAt: true },
    });

    return keys;
  }

  async createForUser(userId: string, name: string) {
    const count = await prisma.apiKey.count({ where: { userId } });
    if (count >= 3) {
      throw new Error(
        "API key limit reached. Revoke an existing key before creating a new one.",
      );
    }

    const rawKey = generateRawApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        key: rawKey,
        name,
        userId,
      },
    });

    await redis.sadd(KEYS.API_KEYS, rawKey);

    return apiKey;
  }

  async renameForUser(userId: string, apiKeyId: string, name: string) {
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        id: apiKeyId,
        userId,
      },
    });

    if (!apiKey) {
      throw new Error("API key not found.");
    }

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { name },
      select: { updatedAt: true },
    });
  }

  async deleteForUser(userId: string, apiKeyId: string) {
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        id: apiKeyId,
        userId,
      },
    });

    if (!apiKey) {
      throw new Error("API key not found.");
    }

    await prisma.apiKey.delete({
      where: { id: apiKey.id },
      select: { updatedAt: true },
    });

    await redis.srem(KEYS.API_KEYS, apiKey.key);
  }

  async claimForUser(userId: string, key: string, name: string) {
    const existsInRedis = await redis.sismember(KEYS.API_KEYS, key);
    if (!existsInRedis) {
      throw new Error("API key not found.");
    }

    const existing = await prisma.apiKey.findUnique({ where: { key } });
    if (existing) {
      if (existing.userId === userId) {
        throw new Error("You have already claimed this API key.");
      }
      throw new Error("This API key has already been claimed by another user.");
    }

    const count = await prisma.apiKey.count({ where: { userId } });
    if (count >= 3) {
      throw new Error(
        "API key limit reached. Revoke an existing key before claiming another.",
      );
    }

    return await prisma.apiKey.create({
      data: { key, name, userId },
    });
  }
}

export { ApiKeyService };
