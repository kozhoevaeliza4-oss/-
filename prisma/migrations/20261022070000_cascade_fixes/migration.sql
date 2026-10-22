-- DropForeignKey
ALTER TABLE "ActLineAllocation" DROP CONSTRAINT "ActLineAllocation_workItemId_fkey";

-- DropForeignKey
ALTER TABLE "ActRecognitionPage" DROP CONSTRAINT "ActRecognitionPage_documentId_fkey";

-- AddForeignKey
ALTER TABLE "ActLineAllocation" ADD CONSTRAINT "ActLineAllocation_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognitionPage" ADD CONSTRAINT "ActRecognitionPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

