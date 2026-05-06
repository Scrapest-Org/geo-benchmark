/*
  Warnings:

  - You are about to drop the column `userId` on the `Webhook` table. All the data in the column will be lost.
  - Added the required column `apiKeyId` to the `Webhook` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Webhook" DROP CONSTRAINT "Webhook_userId_fkey";

-- DropIndex
DROP INDEX "Webhook_userId_idx";

-- AlterTable
ALTER TABLE "Webhook" DROP COLUMN "userId",
ADD COLUMN     "apiKeyId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Webhook_apiKeyId_idx" ON "Webhook"("apiKeyId");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
