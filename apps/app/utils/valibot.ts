import {
  check,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  optional,
  picklist,
  pipe,
  regex,
  string,
  toUpperCase,
  transform,
  union,
  url,
} from "valibot";

const UrlSchema = pipe(
  string("URL must be a string"),
  url("URL must be valid"),
);

const XUsernameSchema = pipe(
  string("Username must be a string"),
  minLength(1, "Username must be at least 1 character."),
  maxLength(15, "Username must be at most 15 characters."),
  regex(
    /^[A-Za-z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores.",
  ),
);
const XUIDSchema = pipe(
  string("X User ID must be a string"),
  minLength(1, "X User ID must be at least 1 character."),
  regex(/^[0-9]+$/, "X User ID can only contain numbers."),
);

const XPostIDSchema = pipe(
  string("X Post ID must be a string"),
  minLength(5, "X Post ID must be at least 5 characters."),
);

const DiscordChannelIDSchema = pipe(
  string("Channel ID must be a string"),
  minLength(15, "Channel ID must be at least 15 characters."),
  regex(/^[0-9]+$/, "Channel ID can only contain numbers."),
);

const ApiKeyNameSchema = pipe(
  string("API key name must be a string"),
  minLength(1, "API key name must not be empty."),
  maxLength(80, "API key name must be at most 80 characters."),
);

const SourceTypeSchema = picklist(
  ["x", "discord", "telegram"],
  "Invalid source type.",
);

const TrackStatusSourceSchema = picklist(
  ["discord", "telegram"],
  "Invalid source for status lookup. Must be 'discord' or 'telegram'.",
);

const ExtendedSourceTypeSchema = picklist(
  ["x", "discord", "telegram", "fast-x"],
  "Invalid source type with fast-x support.",
);

const SearchQuerySchema = pipe(
  string("Query must be a string"),
  minLength(1, "Query must be at least 1 character."),
  maxLength(1000, "Query must be at most 1000 characters."),
);

const SearchCountSchema = pipe(
  number("Count must be a number"),
  minValue(1, "Count must be at least 1."),
  maxValue(50, "Count must be at most 50."),
);

const SearchCursorSchema = pipe(
  string("Cursor must be a string"),
  minLength(1, "Cursor cannot be empty."),
);
const ResultTypesSchema = picklist(
  ["cashtags", "events", "users", "topics", "lists"],
  "Invalid result type",
);

const GetTrackedSourceByIdSchema = union([
  object({ eid: string("External ID must be a string") }),
  object({ iid: string("Internal ID must be a string") }),
]);

const BackfillRequestSchema = object({
  xuid: XUIDSchema,
  cursor: optional(
    pipe(
      string("Cursor must be a string"),
      minLength(1, "Cursor cannot be empty."),
    ),
  ),
});

// ── Backfill query schemas ──────────────────────────────────────────

const TrackedSourceDbSchema = picklist(
  ["X", "DISCORD", "TELEGRAM"],
  "Invalid source. Must be X, DISCORD or TELEGRAM",
);

const SortOrderSchema = picklist(
  ["asc", "desc"],
  "Order must be 'asc' or 'desc'",
);

const ISODateSchema = pipe(
  string("Date must be an ISO-8601 string"),
  regex(/^\d{4}-\d{2}-\d{2}/, "Date must start with YYYY-MM-DD"),
);

const StringToIntSchema = (label: string, min: number, max: number) =>
  pipe(
    string(`${label} must be a string`),
    transform((v) => Number(v)),
    number(`${label} must be numeric`),
    minValue(min, `${label} must be at least ${min}`),
    maxValue(max, `${label} must be at most ${max}`),
  );

/** Dashboard backfill — page-based pagination, no rawPayload */
const BackfillDashboardQuerySchema = object({
  page: optional(StringToIntSchema("page", 1, 10000)),
  limit: optional(StringToIntSchema("limit", 1, 100)),
  source: optional(TrackedSourceDbSchema),
  sourceId: optional(pipe(string(), minLength(1, "sourceId cannot be empty"))),
  messageId: optional(
    pipe(string(), minLength(1, "messageId cannot be empty")),
  ),
  startDate: optional(ISODateSchema),
  endDate: optional(ISODateSchema),
  order: optional(SortOrderSchema),
});

/** API backfill — cursor-based pagination, includes rawPayload */
const BackfillApiQuerySchema = object({
  cursor: optional(pipe(string(), minLength(1, "cursor cannot be empty"))),
  limit: optional(StringToIntSchema("limit", 1, 100)),
  messageId: optional(
    pipe(string(), minLength(1, "messageId cannot be empty")),
  ),
  startDate: optional(ISODateSchema),
  endDate: optional(ISODateSchema),
  order: optional(SortOrderSchema),
  autoBackfill: optional(picklist(["true", "false"])),
});

/** PUT /backfill — trigger a historical backfill for an account */
const TriggerBackfillSchema = object({
  id: pipe(
    string("Internal ID must be a string"),
    minLength(1, "Internal ID cannot be empty"),
  ),
});

const AccountHistoryParamsSchema = object({
  source: pipe(
    string("Source must be a string"),
    toUpperCase(),
    check(
      (v): v is "X" | "DISCORD" | "TELEGRAM" =>
        (["X", "DISCORD", "TELEGRAM"] as const).includes(v as any),
      "Invalid source. Must be X, DISCORD or TELEGRAM",
    ),
  ),
  externalId: XUIDSchema,
});

const MentionsQuerySchema = object({
  ticker: optional(string("ticker must be a string")),
  contractAddress: optional(string("contractAddress must be a string")),
  source: optional(TrackedSourceDbSchema),
  cursor: optional(pipe(string(), minLength(1, "cursor cannot be empty"))),
  limit: optional(StringToIntSchema("limit", 1, 100)),
  order: optional(SortOrderSchema),
});

const FindTrackedSourceSchema = object({
  query: pipe(string(), minLength(1, "Query must be at least 1 character")),
  page: optional(StringToIntSchema("page", 1, 10000)),
  limit: optional(StringToIntSchema("limit", 1, 100)),
});

const REGEX_CHANNEL_WITH_AT = /^@[a-zA-Z0-9_]{5,32}$/;
const REGEX_CHANNEL_NO_AT = /^[a-zA-Z0-9_]{5,32}$/;
const REGEX_INVITE_LINK =
  /^(https?:\/\/)?t\.me\/(\+|joinchat\/)?[A-Za-z0-9_-]+$/;

const TelegramChannelOrInviteSchema = pipe(
  string("Input must be a string"),

  check((input) => {
    return (
      REGEX_CHANNEL_WITH_AT.test(input) ||
      REGEX_CHANNEL_NO_AT.test(input) ||
      REGEX_INVITE_LINK.test(input)
    );
  }, "Must be a valid Telegram username (@user or user) or invite link (t.me/...)..."),
);

const TelegramSourceSchema = pipe(
  string(),
  regex(
    /^-?\d+(\|-?\d+)?$/,
    "Invalid format: Must be a numeric ID (e.g. 123456) or ID|Hash pair.",
  ),
);

const FinalizeTrackSchema = object({
  apiKey: string("API key must be a string"),
  source: picklist(["discord", "telegram"], "Invalid source"),
  externalId: string("External ID must be a string"),
  data: object({
    name: optional(string("Name must be a string")),
    username: optional(string("Username must be a string")),
  }),
});

const TelegramLimitSchema = pipe(number("Limit must be numeric"), minValue(1), maxValue(100));
const TelegramChannelIdSchema = pipe(string("Channel ID must be a string"), minLength(1));
const TelegramMessageIdSchema = pipe(string("Message ID must be a string"), regex(/^[0-9]+$/, "Message ID can only contain numbers."));
const TelegramOptionalSearchQuerySchema = pipe(string("Query must be a string"), maxLength(1000));
const TelegramChannelTypeSchema = picklist(["links", "photos", "videos", "documents"], "Invalid channel type");

export {
  ApiKeyNameSchema,
  UrlSchema,
  XUsernameSchema,
  XUIDSchema,
  XPostIDSchema,
  DiscordChannelIDSchema,
  SourceTypeSchema,
  TrackStatusSourceSchema,
  ExtendedSourceTypeSchema,
  SearchQuerySchema,
  SearchCountSchema,
  SearchCursorSchema,
  ResultTypesSchema,
  GetTrackedSourceByIdSchema,
  BackfillRequestSchema,
  BackfillDashboardQuerySchema,
  BackfillApiQuerySchema,
  TriggerBackfillSchema,
  AccountHistoryParamsSchema,
  MentionsQuerySchema,
  FindTrackedSourceSchema,
  TelegramChannelOrInviteSchema,
  TelegramSourceSchema,
  FinalizeTrackSchema,
  TelegramLimitSchema,
  TelegramChannelIdSchema,
  TelegramMessageIdSchema,
  TelegramOptionalSearchQuerySchema,
  TelegramChannelTypeSchema,
};

export type EIDorIID = { eid: string } | { iid: string };
