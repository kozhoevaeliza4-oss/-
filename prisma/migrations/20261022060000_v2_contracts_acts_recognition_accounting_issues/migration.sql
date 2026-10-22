-- CreateEnum
CREATE TYPE "ContractSigningStatus" AS ENUM ('UNKNOWN', 'NOT_SIGNED', 'PARTIALLY_SIGNED', 'SIGNED');

-- CreateEnum
CREATE TYPE "RecognitionStatus" AS ENUM ('UPLOADED', 'QUEUED', 'RECOGNIZING', 'NEEDS_REVIEW', 'REVIEWED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('UNCLASSIFIED', 'COST', 'ADJUSTMENT', 'REVERSAL', 'INTERNAL_TRANSFER', 'SETTLEMENT', 'PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_REVIEW', 'NEEDS_DECISION', 'RESOLVED', 'CLOSED_EXCEPTION');

-- AlterEnum (сохраняем данные: переименование значения вместо пересоздания типа)
ALTER TYPE "ActStatus" RENAME VALUE 'PREPARED' TO 'DRAFT';
ALTER TYPE "ActStatus" ADD VALUE 'CORRECTED';
ALTER TYPE "ActStatus" ADD VALUE 'ANNULLED';

-- AlterEnum
ALTER TYPE "ClassificationStatus" RENAME VALUE 'CLASSIFIED' TO 'CONFIRMED';
ALTER TYPE "ClassificationStatus" ADD VALUE 'PROPOSED';

-- DropForeignKey
ALTER TABLE "ActLine" DROP CONSTRAINT "ActLine_workItemId_fkey";

-- AlterTable
ALTER TABLE "AccountingImport" ADD COLUMN     "acceptedTotal" DECIMAL(18,2),
ADD COLUMN     "duplicateRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fileSha256" TEXT,
ADD COLUMN     "newRows" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AccountingTransaction" ADD COLUMN     "category" "TransactionCategory" NOT NULL DEFAULT 'UNCLASSIFIED',
ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "classifiedById" TEXT,
ADD COLUMN     "contractText" TEXT,
ADD COLUMN     "possibleDuplicateOfId" TEXT,
ADD COLUMN     "ruleId" TEXT;

-- AlterTable
ALTER TABLE "Act" ADD COLUMN     "amountInWords" TEXT,
ADD COLUMN     "annulledAt" TIMESTAMP(3),
ADD COLUMN     "contractText" TEXT,
ADD COLUMN     "contractorInn" TEXT,
ADD COLUMN     "contractorName" TEXT,
ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "documentTotal" DECIMAL(18,2),
ADD COLUMN     "duplicateDecision" TEXT,
ADD COLUMN     "limitOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "limitOverrideById" TEXT,
ADD COLUMN     "limitOverrideComment" TEXT,
ADD COLUMN     "objectText" TEXT,
ADD COLUMN     "signatories" TEXT,
ADD COLUMN     "signedById" TEXT,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "vatAmount" DECIMAL(18,2),
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ActLine" ADD COLUMN     "code" TEXT,
ADD COLUMN     "directCosts" DECIMAL(18,2),
ADD COLUMN     "lineNo" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "pageNumber" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unmatched" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "contractorInn" TEXT,
ADD COLUMN     "overAllocationAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overAllocationById" TEXT,
ADD COLUMN     "overAllocationComment" TEXT,
ADD COLUMN     "signingStatus" "ContractSigningStatus" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "ActLineAllocation" (
    "id" TEXT NOT NULL,
    "actLineId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActLineAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActRecognition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "RecognitionStatus" NOT NULL DEFAULT 'UPLOADED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressText" TEXT,
    "error" TEXT,
    "ocrProvider" TEXT,
    "rawText" TEXT,
    "fields" JSONB,
    "lines" JSONB,
    "checks" JSONB,
    "matches" JSONB,
    "duplicates" JSONB,
    "duplicateDecision" TEXT,
    "actId" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActRecognitionPage" (
    "id" TEXT NOT NULL,
    "recognitionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "sourcePage" INTEGER,
    "processedPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "rotation" INTEGER,
    "meanConfidence" DOUBLE PRECISION,
    "words" JSONB,
    "error" TEXT,

    CONSTRAINT "ActRecognitionPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "account" TEXT,
    "corrAccount" TEXT,
    "textContains" TEXT,
    "counterpartyContains" TEXT,
    "category" "TransactionCategory" NOT NULL,
    "workItemId" TEXT,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'NEW',
    "workItemId" TEXT,
    "contractId" TEXT,
    "actId" TEXT,
    "transactionId" TEXT,
    "amount" DECIMAL(18,2),
    "source" TEXT NOT NULL,
    "details" TEXT,
    "assigneeId" TEXT,
    "comment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "IssueStatus",
    "toStatus" "IssueStatus",
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActLineAllocation_workItemId_idx" ON "ActLineAllocation"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ActLineAllocation_actLineId_workItemId_key" ON "ActLineAllocation"("actLineId", "workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ActRecognition_actId_key" ON "ActRecognition"("actId");

-- CreateIndex
CREATE INDEX "ActRecognition_projectId_status_idx" ON "ActRecognition"("projectId", "status");

-- CreateIndex
CREATE INDEX "ActRecognitionPage_recognitionId_idx" ON "ActRecognitionPage"("recognitionId");

-- CreateIndex
CREATE INDEX "Issue_projectId_status_idx" ON "Issue"("projectId", "status");

-- CreateIndex
CREATE INDEX "Issue_projectId_type_idx" ON "Issue"("projectId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_projectId_key_key" ON "Issue"("projectId", "key");

-- CreateIndex
CREATE INDEX "IssueEvent_issueId_createdAt_idx" ON "IssueEvent"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingTransaction_projectId_category_classification_idx" ON "AccountingTransaction"("projectId", "category", "classification");

-- CreateIndex
CREATE INDEX "AccountingTransaction_projectId_date_idx" ON "AccountingTransaction"("projectId", "date");

-- CreateIndex
CREATE INDEX "Act_projectId_status_idx" ON "Act"("projectId", "status");

-- CreateIndex
CREATE INDEX "Act_projectId_number_idx" ON "Act"("projectId", "number");

-- CreateIndex
CREATE INDEX "Contract_projectId_status_idx" ON "Contract"("projectId", "status");

-- CreateIndex
CREATE INDEX "ContractWorkAllocation_workItemId_idx" ON "ContractWorkAllocation"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");

-- CreateIndex
CREATE INDEX "Payment_projectId_contractId_idx" ON "Payment"("projectId", "contractId");

-- CreateIndex
CREATE INDEX "TransactionAllocation_transactionId_idx" ON "TransactionAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionAllocation_workItemId_idx" ON "TransactionAllocation"("workItemId");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_objectId_idx" ON "WorkItem"("projectId", "objectId");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_stageId_idx" ON "WorkItem"("projectId", "stageId");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_sectionId_idx" ON "WorkItem"("projectId", "sectionId");

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_correctsActId_fkey" FOREIGN KEY ("correctsActId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActLineAllocation" ADD CONSTRAINT "ActLineAllocation_actLineId_fkey" FOREIGN KEY ("actLineId") REFERENCES "ActLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActLineAllocation" ADD CONSTRAINT "ActLineAllocation_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognition" ADD CONSTRAINT "ActRecognition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognition" ADD CONSTRAINT "ActRecognition_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognition" ADD CONSTRAINT "ActRecognition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognitionPage" ADD CONSTRAINT "ActRecognitionPage_recognitionId_fkey" FOREIGN KEY ("recognitionId") REFERENCES "ActRecognition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActRecognitionPage" ADD CONSTRAINT "ActRecognitionPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingTransaction" ADD CONSTRAINT "AccountingTransaction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ClassificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "AccountingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Перенос связей строк АВР со статьями в таблицу распределений
INSERT INTO "ActLineAllocation" ("id", "actLineId", "workItemId", "quantity", "amount")
SELECT 'mig_' || "id", "id", "workItemId", "quantity", "amount" FROM "ActLine" WHERE "workItemId" IS NOT NULL;
ALTER TABLE "ActLine" DROP COLUMN "workItemId";
