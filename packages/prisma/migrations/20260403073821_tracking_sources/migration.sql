-- CreateTable
CREATE TABLE "TrackedSourceMapping" (
    "id" TEXT NOT NULL,
    "sourceInfoId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedSourceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedSourceMapping_sourceInfoId_idx" ON "TrackedSourceMapping"("sourceInfoId");

-- CreateIndex
CREATE INDEX "TrackedSourceMapping_apiKey_idx" ON "TrackedSourceMapping"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedSourceMapping_sourceInfoId_apiKey_key" ON "TrackedSourceMapping"("sourceInfoId", "apiKey");

-- AddForeignKey
ALTER TABLE "TrackedSourceMapping" ADD CONSTRAINT "TrackedSourceMapping_sourceInfoId_fkey" FOREIGN KEY ("sourceInfoId") REFERENCES "SourceInfo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedSourceMapping" ADD CONSTRAINT "TrackedSourceMapping_apiKey_fkey" FOREIGN KEY ("apiKey") REFERENCES "ApiKey"("key") ON DELETE CASCADE ON UPDATE CASCADE;
