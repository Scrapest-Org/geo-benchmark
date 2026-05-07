import { maxLength, minLength, pipe, regex, string } from "valibot";

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

export { XUsernameSchema, XUIDSchema };
