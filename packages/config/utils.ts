import dotenv from "dotenv";
import { join } from "path";
import fs from "fs";

const ROOT_DIR = process.cwd();
const envPath = join(ROOT_DIR, ".env");
const backupPath = join(ROOT_DIR, ".env.bak");

dotenv.config({ path: join(ROOT_DIR, ".env.local") });
dotenv.config({ path: envPath });

export function getEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Environment variable "${key}" is not set.`);
  }
  return value;
}

export function getEnvOrNull(key: string, fallback: string | null = null) {
  const value = process.env[key];
  return value ?? fallback;
}

export function saveEnv(key: string, value: string) {
  let lines: string[] = [];

  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, backupPath);
    lines = fs.readFileSync(envPath, "utf-8").split("\n");
  }

  let found = false;
  const newLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}="${value}"`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${key}="${value}"`);
  }

  fs.writeFileSync(envPath, newLines.join("\n"));
  console.log(`✅ Saved ${key} to .env (backup at .env.bak)`);
}
