-- AddForeignKey
ALTER TABLE "BackfillData" ADD CONSTRAINT "BackfillData_source_sourceId_fkey" FOREIGN KEY ("source", "sourceId") REFERENCES "SourceInfo"("source", "externalId") ON DELETE RESTRICT ON UPDATE CASCADE;
