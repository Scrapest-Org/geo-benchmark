import type { Response } from "express";
import { Sentry } from "@scrapest/config";
import { ValiError } from "valibot";
import { alert } from "@scrapest/core/utils";

function handleError(res: Response, error: unknown, status?: number) {
  if (error instanceof ValiError) {
    return res
      .status(422)
      .json({ status: "fail", error: error.message, issues: error.issues });
  }

  Sentry.captureException(error);
  alert.error(JSON.stringify(error), `app-error-${status ?? 401}`).then(() => {
    console.error(error);
  });
  if (error instanceof Error) {
    return res
      .status(status ?? 400)
      .json({ status: "error", error: error.message });
  }
  return res
    .status(status ?? 500)
    .json({ status: "unknown error", error: String(error) });
}

export { handleError };
