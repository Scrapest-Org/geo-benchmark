// Strip ts-proto's default-value elision from encoder branches.
//
// ts-proto generates encoder code like:
//   if (message.foo !== undefined && message.foo !== false) { writer.uint32(96).bool(message.foo); }
// which skips writing fields whose value happens to equal the proto-declared
// default. For a proto2 schema with explicit `optional` keywords (which ours
// is), this is wrong: we want presence tracking, not default elision. The
// upstream `prost`-generated Rust code respects proto2 presence semantics, so
// for byte-level wire compatibility with the Rust port we have to disable
// the elision here. ts-proto offers no flag for this; the cheapest fix is a
// post-process sed-style rewrite of the generated encoders.
//
// Replaces:
//   if (message.X !== undefined && message.X !== <constant>)
// with:
//   if (message.X !== undefined)
//
// where <constant> is the field's declared proto default. Decode/JSON paths
// are left alone since they only reflect input, not output.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["gen/mcs.ts", "gen/checkin.ts"];

const PATTERN =
  /if \((message\.[a-zA-Z_][a-zA-Z0-9_]*) !== undefined && \1 !== [^)]+?\) \{\n(\s+)writer\./g;

let total = 0;
for (const rel of FILES) {
  const path = join(process.cwd(), rel);
  const src = readFileSync(path, "utf8");
  let count = 0;
  const out = src.replace(PATTERN, (_match, ref, indent) => {
    count++;
    return `if (${ref} !== undefined) {\n${indent}writer.`;
  });
  writeFileSync(path, out);
  console.log(`patched ${rel}: ${count} encoder branches`);
  total += count;
}
console.log(`total: ${total}`);
