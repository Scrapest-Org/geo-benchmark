import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@scrapest/config";
import { PrismaClient } from "@scrapest/prisma";
import { Pool } from "pg";

declare global {
  var __scrapestAppPrismaRuntime:
    | {
        client: PrismaClient;
        pool: Pool;
      }
    | undefined;
}

function createRuntime() {
  const pool = new Pool({
    connectionString: getEnv("DATABASE_URL"),
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  return { client, pool };
}

const runtime = globalThis.__scrapestAppPrismaRuntime ?? createRuntime();

if (process.env.NODE_ENV !== "production") {
  globalThis.__scrapestAppPrismaRuntime = runtime;
}

const prisma = runtime.client;

async function closePrisma() {
  await prisma.$disconnect();
  await runtime.pool.end();
}

export { closePrisma, prisma };
