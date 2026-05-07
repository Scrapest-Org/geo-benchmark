import type { SourceType } from "@scrapest/core/lib/resolvers";
import { SourceMapping } from "./mapping";
import type { AppService } from "./app";
import { XUsernameSchema } from "../utils/valibot";
import { parse } from "valibot";
import { redis } from "bun";

type JobStatus = {
  jobId: string;
  name: string;
  state: string;
  progress: number | object;
  attempts: number;
  failedReason?: string;
  returnValue?: unknown;
};

abstract class Tracking {
  protected readonly map: SourceMapping;

  abstract track(key: string, sid: string): Promise<unknown>;
  abstract untrack(key: string, sid: string): Promise<Record<string, any>>;

  getTracked = async (key: string) => await this.map.getTracked(key);
  private readonly source: SourceType;

  constructor(type: SourceType) {
    this.source = type;
    this.map = new SourceMapping(type);
  }

  async add(key: string, eid: string) {
    await Promise.all([
      this.map.track(key, eid),
      redis.sadd(`bucket:${this.source}`, eid),
    ]);
  }

  async remove(key: string, id: string) {
    const othersTracking = await this.map.untrack(key, id);
    await redis.srem(`bucket:${this.source}`, id);
    return othersTracking;
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

    if (!following) await this.app.enqueueFollow(id, x_username);
    await super.add(key, id);

    return { id, ...u };
  }

  async untrack(key: string, sid: string) {
    const x_username = parse(XUsernameSchema, sid);
    const { following, id, ...u } = await this.app.checkUser(x_username);
    if (!id) throw new Error(`"${x_username}" has no resolvable ID on X`);

    const othersTracking = await super.remove(key, id);

    if (!othersTracking && following)
      await this.app.enqueueUnfollow(id, x_username);
    return u;
  }
}
export { Tracking, XTracking };
export type { JobStatus };
