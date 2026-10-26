-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('DRAFT', 'DOCTOR_REVIEW', 'DOCTOR_APPROVED', 'MARKETING_REVIEW', 'RETURNED', 'READY_TO_PUBLISH', 'PUBLISHED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MANAGER',
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactVerified" BOOLEAN NOT NULL DEFAULT false,
    "group" TEXT NOT NULL DEFAULT 'default',
    "responsibleId" TEXT,
    "publicUrls" JSONB NOT NULL DEFAULT '{}',
    "workflowState" "WorkflowState" NOT NULL DEFAULT 'DRAFT',
    "lastDoctorReviewAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "purpose" TEXT NOT NULL DEFAULT 'invite',
    "sentMarkedAt" TIMESTAMP(3),
    "sentMarkedBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorSession" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProfileDraft" (
    "specialistId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,
    "fieldMeta" JSONB NOT NULL DEFAULT '{}',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "aiResult" JSONB,
    "selectedPhotoId" TEXT,
    "freeText" TEXT NOT NULL DEFAULT '',
    "wizardStep" INTEGER NOT NULL DEFAULT 1,
    "basedOnVersionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProfileDraft_pkey" PRIMARY KEY ("specialistId")
);

-- CreateTable
CREATE TABLE "FactProvenance" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "extractedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportConflict" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" JSONB NOT NULL,
    "importedValue" JSONB NOT NULL,
    "sourceRef" TEXT,
    "excerpt" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileVersion" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contentEt" JSONB NOT NULL,
    "contentEn" JSONB,
    "contentRu" JSONB,
    "photoVersionId" TEXT,
    "formattingOnlyFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "approverType" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "languages" TEXT[],
    "photoVersionId" TEXT,
    "snapshot" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'APPROVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoVersion" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "settings" JSONB,
    "qualityNotes" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationMark" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "urls" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PublicationMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerTask" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "details" JSONB,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "et" TEXT NOT NULL,
    "en" TEXT NOT NULL,
    "ru" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileVersion_specialistId_number_key" ON "ProfileVersion"("specialistId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerTask_dedupeKey_key" ON "ManagerTask"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialist" ADD CONSTRAINT "Specialist_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSession" ADD CONSTRAINT "DoctorSession_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDraft" ADD CONSTRAINT "ProfileDraft_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactProvenance" ADD CONSTRAINT "FactProvenance_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportConflict" ADD CONSTRAINT "ImportConflict_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileVersion" ADD CONSTRAINT "ProfileVersion_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoVersion" ADD CONSTRAINT "PhotoVersion_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMark" ADD CONSTRAINT "PublicationMark_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMark" ADD CONSTRAINT "PublicationMark_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerTask" ADD CONSTRAINT "ManagerTask_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

