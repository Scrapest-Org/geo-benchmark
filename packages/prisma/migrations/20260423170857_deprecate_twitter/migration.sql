/*
  Warnings:

  - The values [TWITTER] on the enum `TrackedSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TrackedSource_new" AS ENUM ('DISCORD', 'TELEGRAM', 'X');
ALTER TABLE "SourceInfo" ALTER COLUMN "source" TYPE "TrackedSource_new" USING ("source"::text::"TrackedSource_new");
ALTER TABLE "BackfillData" ALTER COLUMN "source" TYPE "TrackedSource_new" USING ("source"::text::"TrackedSource_new");
ALTER TYPE "TrackedSource" RENAME TO "TrackedSource_old";
ALTER TYPE "TrackedSource_new" RENAME TO "TrackedSource";
DROP TYPE "public"."TrackedSource_old";
COMMIT;
