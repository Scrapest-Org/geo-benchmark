import type { Response } from "express";
import { ValiError } from "valibot";

function handleError(res: Response, error: unknown, status?: number) {
  if (error instanceof ValiError) {
    return res
      .status(422)
      .json({ status: "fail", error: error.message, issues: error.issues });
  }

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
