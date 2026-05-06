import * as Sentry from "@sentry/bun";
import { getEnv } from "./utils";

Sentry.init({ dsn: getEnv("SENTRY_DSN") });

export { Sentry };
