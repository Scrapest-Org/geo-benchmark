import type { Request, Response } from "express";
import { handleError } from "../utils/express";
import { AppService } from "../services/app";
import { XTracking } from "../services/tracking";

export class TrackingController {
  private readonly tracker: XTracking;

  constructor(private readonly app: AppService) {
    this.tracker = new XTracking(app);
  }

  public track = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const sid = req.body.sid as any;

      if (!sid) throw new Error("Missing 'source ID' in request body");
      if (!apiKey) throw new Error("Missing API key in request context");

      const data = await this.tracker.track(apiKey, sid);
      return res.status(200).json({
        message: `Now tracking ${data.name ?? data.id}`,
        data,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public untrack = async (req: Request, res: Response) => {
    try {
      const apiKey = req.apiKey;
      const sid = req.body.sid as any;

      if (!apiKey) throw new Error("Missing API key in request context");
      const data = await this.tracker.untrack(apiKey, sid);

      return res.status(200).json({
        message: `Stopped tracking`,
        data,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };
}
