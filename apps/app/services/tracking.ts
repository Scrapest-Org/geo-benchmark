import type { SourceType } from "@scrapest/core/lib/resolvers";
import type { SourceInfo, TrackedSource } from "@scrapest/prisma";
import { SourceMapping } from "./mapping";
import type { AppService } from "./app";
import {
  XUsernameSchema,
  DiscordChannelIDSchema,
  TelegramChannelOrInviteSchema,
  type EIDorIID,
} from "../utils/valibot";
import { parse } from "valibot";
import { prisma } from "./prisma";
import { discordQueue, telegramQueue } from "../utils/queues";
import { redis } from "bun";
import type { Queue } from "bullmq";

type JobStatus = {
  jobId: string;
  name: string;
  state: string;
  progress: number | object;
  attempts: number;
  failedReason?: string;
  returnValue?: unknown;
};

type InferSourceInfo = Pick<
  SourceInfo,
  "externalId" | "name" | "username" | "id"
>;
type AddSourceInfo = Omit<InferSourceInfo, "externalId" | "id">;

abstract class Tracking {
  protected readonly map: SourceMapping;
  protected readonly tracked_source: TrackedSource;

  abstract track(
    key: string,
    sid: string,
  ): Promise<InferSourceInfo | { jobId: string }>;
  abstract _track(
    key: string,
    externalId: string,
    data: AddSourceInfo,
  ): Promise<InferSourceInfo>;
  abstract untrack(key: string, id: EIDorIID): Promise<Record<string, any>>;

  /**
   * Retrieves a BullMQ job status. Override in subclasses that use async queues.
   * Targets: state, progress, failedReason, returnValue.
   */
  async getJobStatus(_jobId: string): Promise<JobStatus | null> {
    throw new Error(`Job status polling is not supported for ${this.source}`);
  }

  /**
   * Shared helper to read status from any BullMQ queue.
   */
  protected async readJobStatus(
    queue: Queue,
    jobId: string,
  ): Promise<JobStatus | null> {
    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    return {
      jobId,
      name: job.name,
      state,
      progress: job.progress as unknown as number,
      attempts: job.attemptsMade,
      failedReason: job.failedReason || undefined,
      returnValue: job.returnvalue ?? undefined,
    };
  }

  getTracked = async (key: string) => await this.map.getTracked(key);
  private source: SourceType;

  constructor(type: SourceType) {
    this.source = type;
    this.map = new SourceMapping(type);
    this.tracked_source = type.toUpperCase() as TrackedSource;
  }

  async add(key: string, eid: string, data: AddSourceInfo) {
    const source = await prisma.sourceInfo.findUnique({
      where: {
        source_externalId: {
          source: this.tracked_source,
          externalId: eid,
        },
      },
      select: { id: true, name: true, username: true },
    });

    if (source) {
      const tracking = await prisma.trackedSourceMapping.findUnique({
        where: {
          sourceInfoId_apiKey: {
            apiKey: key,
            sourceInfoId: source.id,
          },
        },
        select: {
          createdAt: true,
        },
      });

      if (tracking)
        throw new Error(
          `You are already tracking ${source.name ?? source.id} since ${tracking.createdAt}`,
        );

      return source;
    } else {
      const { id } = await prisma.sourceInfo.create({
        data: {
          externalId: eid,
          source: this.tracked_source,
          username: data.username,
          name: data.name,
        },
        select: { id: true },
      });

      return { ...data, id };
    }
  }

  async finalizeAdd(key: string, eid: string) {
    await Promise.all([
      this.map.track(key, eid),
      redis.sadd(`bucket:${this.source}`, eid),
    ]);
  }

  async remove(key: string, id: EIDorIID) {
    const source = await prisma.sourceInfo.findUnique({
      where:
        "eid" in id
          ? {
              source_externalId: {
                source: this.tracked_source,
                externalId: id.eid,
              },
            }
          : { id: id.iid },
    });
    if (!source)
      throw new Error(`${"eid" in id ? id.eid : id.iid} source was not found`);

    const othersTracking = await this.map.untrack(key, source.externalId);
    const deleteStale = [
      redis.srem(`bucket:${this.source}`, source.externalId),
      prisma.sourceInfo.delete({
        where: { id: source.id },
        select: { id: true },
      }),
    ];

    await Promise.all([
      prisma.trackedSourceMapping.deleteMany({
        where: {
          sourceInfoId: source.id,
          apiKey: key,
        },
      }),
      ...(!othersTracking ? deleteStale : []),
    ]);

    return { source, othersTracking };
  }
}

class XTracking extends Tracking {
  constructor(private readonly app: AppService) {
    super("x");
  }

  async track(key: string, sid: string) {
    const x_username = parse(XUsernameSchema, sid);
    const { following, id, ...u } = await this.app.checkUser(x_username);
    if (!id) throw new Error(`"${x_username}" has no resolvable ID on X`);

    const source = await super.add(key, id, u);

    if (!following) await this.app.enqueueFollow(id, x_username);
    await super.finalizeAdd(key, id);

    return {
      ...source,
      externalId: id,
    };
  }

  async _track(
    _key: string,
    _externalId: string,
    _data: AddSourceInfo,
  ): Promise<InferSourceInfo> {
    throw new Error("X doesn't require a second step to track");
  }

  async untrack(key: string, id: EIDorIID) {
    const { source, othersTracking } = await super.remove(key, id);
    if (!source.username) throw new Error("This is not a valid X user");

    const { following, ...u } = await this.app.checkUser(source.username);
    if (!othersTracking && following)
      await this.app.enqueueUnfollow(source.externalId, source.username);
    return u;
  }
}

class DiscordTracking extends Tracking {
  constructor() {
    super("discord");
  }

  async track(key: string, sid: string) {
    const channelId = parse(DiscordChannelIDSchema, sid);
    const source = await super.add(key, channelId, {
      name: null,
      username: null,
    });

    const exists = await this.map.isGloballyTracked(channelId);
    if (!exists) {
      await discordQueue.add("track", {
        apiKey: key,
        channelId,
        sourceInfoId: source.id,
      });
    }

    await super.finalizeAdd(key, channelId);
    return {
      ...source,
      externalId: channelId,
    };
  }

  async _track(
    _key: string,
    _externalId: string,
    _data: AddSourceInfo,
  ): Promise<InferSourceInfo> {
    throw new Error("Discord doesn't require a second step to track");
  }

  async untrack(key: string, id: EIDorIID) {
    const { source, othersTracking } = await super.remove(key, id);

    if (!othersTracking)
      await discordQueue.add("untrack", {
        apiKey: key,
        channelId: source.externalId,
      });
    return source;
  }
}

class TelegramTracking extends Tracking {
  constructor() {
    super("telegram");
  }

  async track(key: string, sid: string) {
    const input = parse(TelegramChannelOrInviteSchema, sid);

    const job = await telegramQueue.add("track", {
      apiKey: key,
      input,
    });

    return { jobId: job.id! };
  }

  async _track(key: string, externalId: string, data: AddSourceInfo) {
    const source = await super.add(key, externalId, data);
    await super.finalizeAdd(key, externalId);

    return {
      ...source,
      externalId,
    };
  }

  override async getJobStatus(jobId: string) {
    return this.readJobStatus(telegramQueue, jobId);
  }

  async untrack(key: string, id: EIDorIID) {
    const { source, othersTracking } = await super.remove(key, id);

    if (!othersTracking)
      await telegramQueue.add("untrack", {
        apiKey: key,
        channelId: source.externalId,
      });
    return source;
  }
}

export { Tracking, XTracking, DiscordTracking, TelegramTracking };
export type { InferSourceInfo, JobStatus };
