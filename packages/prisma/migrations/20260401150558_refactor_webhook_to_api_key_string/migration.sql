/*
  Warnings:

  - You are about to drop the column `apiKeyId` on the `Webhook` table. All the data in the column will be lost.
  - Added the required column `apiKey` to the `Webhook` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Webhook" DROP CONSTRAINT "Webhook_apiKeyId_fkey";

-- DropIndex
DROP INDEX "Webhook_apiKeyId_idx";

-- AlterTable
ALTER TABLE "Webhook" DROP COLUMN "apiKeyId",
ADD COLUMN     "apiKey" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Webhook_apiKey_idx" ON "Webhook"("apiKey");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_apiKey_fkey" FOREIGN KEY ("apiKey") REFERENCES "ApiKey"("key") ON DELETE CASCADE ON UPDATE CASCADE;
