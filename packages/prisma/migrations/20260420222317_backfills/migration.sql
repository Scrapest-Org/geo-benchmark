-- CreateTable
CREATE TABLE "BackfillData" (
    "id" TEXT NOT NULL,
    "source" "TrackedSource" NOT NULL,
    "messageId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillData_source_sourceId_createdAt_idx" ON "BackfillData"("source", "sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillData_source_messageId_key" ON "BackfillData"("source", "messageId");
