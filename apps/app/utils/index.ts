import type { SourceType } from "@scrapest/core/resolvers";
import type { TrackedSource } from "@scrapest/prisma";

function getDbMapping(source: SourceType): TrackedSource {
  switch (source) {
    case "x":
      return "X";
    case "discord":
      return "DISCORD";
    case "telegram":
      return "TELEGRAM";
  }
}

export { getDbMapping };
