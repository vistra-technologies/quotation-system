-- Stage 23 Batch 1: FormulaSet + Organization.activeFormulaSetId + Project.formulaSetId
-- + ProjectCalculation. Purely additive (new table, nullable FK columns) — no backfill,
-- no data loss risk. Batch 2's seed sets `activeFormulaSetId` for seeded orgs; Batch 2's
-- backfill script (`backfill-formula-set-pins.ts`) pins pre-existing orgs/projects created
-- before this migration landed. See stage-23.md — "Summary output shape" / Batch 1.

-- ── 1. FormulaSet (platform-level, no organizationId) ─────────────────────────

CREATE TABLE "FormulaSet" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "version"     INTEGER NOT NULL,
    "body"        JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormulaSet_pkey" PRIMARY KEY ("id")
);

-- Immutability key: a given (name, version) is never updated in place (see model comment).
CREATE UNIQUE INDEX "FormulaSet_name_version_key" ON "FormulaSet"("name", "version");

-- ── 2. Organization.activeFormulaSetId ────────────────────────────────────────

ALTER TABLE "Organization" ADD COLUMN "activeFormulaSetId" TEXT;

ALTER TABLE "Organization"
    ADD CONSTRAINT "Organization_activeFormulaSetId_fkey"
    FOREIGN KEY ("activeFormulaSetId") REFERENCES "FormulaSet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. Project.formulaSetId ────────────────────────────────────────────────────

ALTER TABLE "Project" ADD COLUMN "formulaSetId" TEXT;

ALTER TABLE "Project"
    ADD CONSTRAINT "Project_formulaSetId_fkey"
    FOREIGN KEY ("formulaSetId") REFERENCES "FormulaSet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4. ProjectCalculation (1:1 with Project) ──────────────────────────────────

CREATE TABLE "ProjectCalculation" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    "formulaSetId"   TEXT NOT NULL,
    "computedAt"     TIMESTAMP(3) NOT NULL,
    "status"         TEXT NOT NULL,
    "errorDetail"    TEXT,
    "summary"        JSONB NOT NULL,
    "materialList"   JSONB NOT NULL DEFAULT '[]',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectCalculation_projectId_key" ON "ProjectCalculation"("projectId");

CREATE INDEX "ProjectCalculation_organizationId_idx" ON "ProjectCalculation"("organizationId");

ALTER TABLE "ProjectCalculation"
    ADD CONSTRAINT "ProjectCalculation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectCalculation"
    ADD CONSTRAINT "ProjectCalculation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectCalculation"
    ADD CONSTRAINT "ProjectCalculation_formulaSetId_fkey"
    FOREIGN KEY ("formulaSetId") REFERENCES "FormulaSet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
