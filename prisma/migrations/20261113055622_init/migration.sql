-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'RESEARCHING', 'RESEARCHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('FULL_RESEARCH', 'SUPPLIER_REFRESH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SearchEngine" AS ENUM ('GOOGLE', 'GOOGLE_MAPS', 'GOOGLE_MAPS_REVIEWS', 'GOOGLE_NEWS');

-- CreateEnum
CREATE TYPE "SearchRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResultKind" AS ENUM ('ORGANIC', 'LOCAL', 'MAPS', 'REVIEW', 'NEWS');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WEBSITE_PAGE', 'SEARCH_SNIPPET', 'MAPS_LISTING', 'REVIEW', 'NEWS', 'MANUAL', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('PHONE', 'EMAIL', 'ADDRESS', 'CERTIFICATION', 'PRODUCT', 'WEBSITE', 'HOURS', 'CATEGORY');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('CORROBORATED', 'CONFLICTING', 'UNCORROBORATED', 'INSUFFICIENT_EVIDENCE', 'MANUALLY_CONFIRMED');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('STRUCTURED_PROVIDER', 'REGEX', 'HTML_STRUCTURED', 'LLM', 'MANUAL');

-- CreateEnum
CREATE TYPE "ClaimReviewStatus" AS ENUM ('UNREVIEWED', 'REVIEWED', 'INCORRECT');

-- CreateEnum
CREATE TYPE "ThreatCategory" AS ENUM ('DIRECT_PROMPT_INJECTION', 'INSTRUCTION_OVERRIDE', 'IGNORE_PREVIOUS', 'SECRET_ACCESS', 'EXTERNAL_COMM_REDIRECT', 'REQUIREMENT_MODIFICATION', 'MALICIOUS_TOOL_INVOCATION', 'CONTACT_SUBSTITUTION', 'OBFUSCATED_INSTRUCTION', 'MULTILINGUAL_INJECTION', 'HIDDEN_CONTENT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DetectionMethod" AS ENUM ('RULE', 'LLM_ASSIST', 'RULE_AND_LLM');

-- CreateEnum
CREATE TYPE "FindingReviewStatus" AS ENUM ('PENDING', 'REVIEWED', 'CONFIRMED', 'DISMISSED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENDING', 'SENT', 'PARTIALLY_SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientSendStatus" AS ENUM ('NOT_SENT', 'QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('CREATE_SUPPLIER_RECORD', 'UPDATE_SUPPLIER_NOTES', 'CREATE_COMPARISON', 'CREATE_RFQ_DRAFT', 'EXPORT_RFQ', 'SEND_RFQ_EMAIL', 'MODIFY_RFQ_RECIPIENT', 'MODIFY_PROJECT_REQUIREMENTS', 'FETCH_URL', 'ACCESS_SECRET', 'FINANCIAL_ACTION');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'BLOCK', 'REQUIRE_APPROVAL', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'NOT_EXECUTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Split" AS ENUM ('DEV', 'HOLDOUT');

-- CreateEnum
CREATE TYPE "Defense" AS ENUM ('BASELINE', 'PROMPT_ONLY', 'REGEX', 'PROXY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationState" AS ENUM ('OK', 'ERROR', 'NOT_CONFIGURED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specifications" TEXT NOT NULL DEFAULT '',
    "materialGrade" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT '',
    "deliveryLocation" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'India',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "maxRadiusKm" INTEGER NOT NULL DEFAULT 100,
    "requiredCertifications" TEXT[],
    "additionalRequirements" TEXT NOT NULL DEFAULT '',
    "preferredSupplierType" TEXT NOT NULL DEFAULT '',
    "excludedSuppliers" TEXT[],
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL DEFAULT 'FULL_RESEARCH',
    "supplierId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "stages" JSONB NOT NULL DEFAULT '[]',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "queue" TEXT NOT NULL DEFAULT 'research.run',
    "queueJobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "retryOfId" TEXT,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT,
    "engine" "SearchEngine" NOT NULL,
    "query" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "providerSearchId" TEXT,
    "status" "SearchRequestStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "error" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "response" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "ResultKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "domain" TEXT,
    "snippet" TEXT,
    "data" JSONB NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "category" TEXT,
    "website" TEXT,
    "domain" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "email" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "mapsPlaceId" TEXT,
    "mapsDataId" TEXT,
    "hours" JSONB,
    "description" TEXT,
    "mapsInfo" JSONB,
    "reviewsSummary" JSONB,
    "aiSummary" JSONB,
    "consistency" JSONB,
    "tags" TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "manualOverrides" JSONB NOT NULL DEFAULT '{}',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "lastResearchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProject" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "relevance" JSONB,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "claimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNCORROBORATED',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCertification" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNCORROBORATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT,
    "jobId" TEXT,
    "searchRequestId" TEXT,
    "searchResultId" TEXT,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "domain" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSearchId" TEXT,
    "title" TEXT,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "text" TEXT NOT NULL,
    "hiddenText" TEXT,
    "structured" JSONB,
    "contentHash" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL DEFAULT 0,
    "fetchError" TEXT,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePassage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidencePassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedClaim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNCORROBORATED',
    "statusReason" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "reviewStatus" "ClaimReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "limitations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "quote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityFinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT,
    "documentId" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "category" "ThreatCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "detectionMethod" "DetectionMethod" NOT NULL DEFAULT 'RULE',
    "ruleId" TEXT NOT NULL,
    "matchedText" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'plain',
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reviewStatus" "FindingReviewStatus" NOT NULL DEFAULT 'PENDING',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "actionProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityReview" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "FindingReviewStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierComparison" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "supplierIds" TEXT[],
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonWeight" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ComparisonWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQRecipient" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "contactId" TEXT,
    "email" TEXT NOT NULL,
    "verification" JSONB,
    "manualConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "sendStatus" "RecipientSendStatus" NOT NULL DEFAULT 'NOT_SENT',
    "providerMessageId" TEXT,
    "providerResponse" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQApproval" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "note" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "params" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "decision" "PolicyDecision" NOT NULL,
    "decisionReasons" JSONB NOT NULL DEFAULT '[]',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rfqId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionExecution" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionReceipt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "executionId" TEXT,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkSuite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '1',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkScenario" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attackCategory" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "deliveryChannel" TEXT NOT NULL,
    "sourceContent" TEXT NOT NULL,
    "userTask" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "expectedPolicyOutcome" "PolicyDecision" NOT NULL,
    "expectedSafeOutcome" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "split" "Split" NOT NULL DEFAULT 'DEV',
    "tags" TEXT[],
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "split" "Split",
    "datasetVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "metrics" JSONB,
    "scenarioCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "defense" "Defense" NOT NULL,
    "isAttack" BOOLEAN NOT NULL,
    "detected" BOOLEAN NOT NULL DEFAULT false,
    "attackSucceeded" BOOLEAN NOT NULL DEFAULT false,
    "unauthorizedActionExecuted" BOOLEAN NOT NULL DEFAULT false,
    "secretExfilAttempted" BOOLEAN NOT NULL DEFAULT false,
    "secretExfilBlocked" BOOLEAN NOT NULL DEFAULT false,
    "taskCompleted" BOOLEAN NOT NULL DEFAULT false,
    "policyOutcome" "PolicyDecision",
    "actionsProposed" INTEGER NOT NULL DEFAULT 0,
    "actionsWithProvenance" INTEGER NOT NULL DEFAULT 0,
    "actionsWithReceipt" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "searchRequests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "trace" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationStatus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "IntegrationState" NOT NULL DEFAULT 'UNKNOWN',
    "message" TEXT,
    "details" JSONB,
    "creditsRemaining" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "SourcingProject_workspaceId_createdAt_idx" ON "SourcingProject"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SourcingProject_workspaceId_status_idx" ON "SourcingProject"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ResearchJob_workspaceId_status_idx" ON "ResearchJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ResearchJob_projectId_createdAt_idx" ON "ResearchJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchRequest_workspaceId_requestedAt_idx" ON "SearchRequest"("workspaceId", "requestedAt");

-- CreateIndex
CREATE INDEX "SearchRequest_cacheKey_status_requestedAt_idx" ON "SearchRequest"("cacheKey", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "SearchRequest_jobId_idx" ON "SearchRequest"("jobId");

-- CreateIndex
CREATE INDEX "SearchResult_workspaceId_dedupKey_idx" ON "SearchResult"("workspaceId", "dedupKey");

-- CreateIndex
CREATE INDEX "SearchResult_supplierId_idx" ON "SearchResult"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchResult_requestId_kind_position_key" ON "SearchResult"("requestId", "kind", "position");

-- CreateIndex
CREATE INDEX "Supplier_workspaceId_normalizedName_idx" ON "Supplier"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "Supplier_workspaceId_domain_idx" ON "Supplier"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Supplier_workspaceId_mapsPlaceId_idx" ON "Supplier"("workspaceId", "mapsPlaceId");

-- CreateIndex
CREATE INDEX "Supplier_workspaceId_lastResearchedAt_idx" ON "Supplier"("workspaceId", "lastResearchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_workspaceId_identityKey_key" ON "Supplier"("workspaceId", "identityKey");

-- CreateIndex
CREATE INDEX "SupplierProject_projectId_matchScore_idx" ON "SupplierProject"("projectId", "matchScore");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProject_supplierId_projectId_key" ON "SupplierProject"("supplierId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_normalizedName_key" ON "SupplierProduct"("supplierId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierContact_supplierId_type_normalizedValue_key" ON "SupplierContact"("supplierId", "type", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCertification_supplierId_normalizedName_key" ON "SupplierCertification"("supplierId", "normalizedName");

-- CreateIndex
CREATE INDEX "SourceDocument_supplierId_retrievedAt_idx" ON "SourceDocument"("supplierId", "retrievedAt");

-- CreateIndex
CREATE INDEX "SourceDocument_workspaceId_sourceType_idx" ON "SourceDocument"("workspaceId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_workspaceId_url_contentHash_key" ON "SourceDocument"("workspaceId", "url", "contentHash");

-- CreateIndex
CREATE INDEX "EvidencePassage_hash_idx" ON "EvidencePassage"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePassage_documentId_ordinal_key" ON "EvidencePassage"("documentId", "ordinal");

-- CreateIndex
CREATE INDEX "ExtractedClaim_workspaceId_claimType_idx" ON "ExtractedClaim"("workspaceId", "claimType");

-- CreateIndex
CREATE INDEX "ExtractedClaim_supplierId_status_idx" ON "ExtractedClaim"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedClaim_supplierId_claimType_normalizedValue_key" ON "ExtractedClaim"("supplierId", "claimType", "normalizedValue");

-- CreateIndex
CREATE INDEX "ClaimEvidence_documentId_idx" ON "ClaimEvidence"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidence_claimId_passageId_key" ON "ClaimEvidence"("claimId", "passageId");

-- CreateIndex
CREATE INDEX "SecurityFinding_workspaceId_reviewStatus_severity_idx" ON "SecurityFinding"("workspaceId", "reviewStatus", "severity");

-- CreateIndex
CREATE INDEX "SecurityFinding_supplierId_idx" ON "SecurityFinding"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_passageId_ruleId_startOffset_variant_key" ON "SecurityFinding"("passageId", "ruleId", "startOffset", "variant");

-- CreateIndex
CREATE INDEX "SecurityReview_findingId_createdAt_idx" ON "SecurityReview"("findingId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierComparison_workspaceId_createdAt_idx" ON "SupplierComparison"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonWeight_comparisonId_component_key" ON "ComparisonWeight"("comparisonId", "component");

-- CreateIndex
CREATE INDEX "RFQ_workspaceId_status_idx" ON "RFQ"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "RFQRecipient_supplierId_idx" ON "RFQRecipient"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "RFQRecipient_rfqId_email_key" ON "RFQRecipient"("rfqId", "email");

-- CreateIndex
CREATE INDEX "RFQApproval_rfqId_approvedAt_idx" ON "RFQApproval"("rfqId", "approvedAt");

-- CreateIndex
CREATE INDEX "ActionProposal_workspaceId_createdAt_idx" ON "ActionProposal"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_workspaceId_decision_idx" ON "ActionProposal"("workspaceId", "decision");

-- CreateIndex
CREATE INDEX "ActionExecution_proposalId_idx" ON "ActionExecution"("proposalId");

-- CreateIndex
CREATE INDEX "ActionReceipt_proposalId_idx" ON "ActionReceipt"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionReceipt_workspaceId_seq_key" ON "ActionReceipt"("workspaceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSuite_workspaceId_name_key" ON "BenchmarkSuite"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkScenario_suiteId_key_key" ON "BenchmarkScenario"("suiteId", "key");

-- CreateIndex
CREATE INDEX "BenchmarkRun_workspaceId_createdAt_idx" ON "BenchmarkRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BenchmarkResult_scenarioId_idx" ON "BenchmarkResult"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkResult_runId_scenarioId_defense_key" ON "BenchmarkResult"("runId", "scenarioId", "defense");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationStatus_workspaceId_provider_key" ON "IntegrationStatus"("workspaceId", "provider");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SourcingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRequest" ADD CONSTRAINT "SearchRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SearchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProject" ADD CONSTRAINT "SupplierProject_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProject" ADD CONSTRAINT "SupplierProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SourcingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCertification" ADD CONSTRAINT "SupplierCertification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_searchRequestId_fkey" FOREIGN KEY ("searchRequestId") REFERENCES "SearchRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_searchResultId_fkey" FOREIGN KEY ("searchResultId") REFERENCES "SearchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePassage" ADD CONSTRAINT "EvidencePassage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedClaim" ADD CONSTRAINT "ExtractedClaim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "EvidencePassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "EvidencePassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_actionProposalId_fkey" FOREIGN KEY ("actionProposalId") REFERENCES "ActionProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReview" ADD CONSTRAINT "SecurityReview_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "SecurityFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierComparison" ADD CONSTRAINT "SupplierComparison_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SourcingProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonWeight" ADD CONSTRAINT "ComparisonWeight_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "SupplierComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SourcingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQRecipient" ADD CONSTRAINT "RFQRecipient_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQRecipient" ADD CONSTRAINT "RFQRecipient_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQRecipient" ADD CONSTRAINT "RFQRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SupplierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQApproval" ADD CONSTRAINT "RFQApproval_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionReceipt" ADD CONSTRAINT "ActionReceipt_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionReceipt" ADD CONSTRAINT "ActionReceipt_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ActionExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkScenario" ADD CONSTRAINT "BenchmarkScenario_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkResult" ADD CONSTRAINT "BenchmarkResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkResult" ADD CONSTRAINT "BenchmarkResult_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "BenchmarkScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
