import type { Prisma } from "@/app/generated/prisma/client";
import {
  loadCalculationInput,
  runPhaseA,
  writeCalculation,
  type CalculationLoad,
} from "@/lib/data/calculations";
import { loadInventoryMap } from "@/lib/data/inventory";
import { loadConfigSnapshot } from "@/lib/config-snapshot";
import { resolveFormulaSetPin } from "@/lib/data/formula-pin";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import { buildSummary } from "@/lib/summary";
import { buildMaterials, type MaterialsInput } from "@/lib/materials/index";
import { resolveAndAggregate } from "@/lib/materials/resolve";
import { ProblemCollector, type CalculationProblemReport } from "@/lib/materials/problems";
import type { RoomSide } from "@/lib/data/rooms";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  // destinationCountry is derived server-side from the linked ExternalCompany.country
  // (Stage 14 Batch C, D19) — callers must NOT supply it.
  currency: string;
  projectLocation?: string | null;
  status: string;
  externalCompanyId?: string | null;
  // Stage 14 Batch A — extended intake fields
  submissionDate?: Date | null;
  projectDeadline?: Date | null;
  projectBudget?: string | null;
  mainContractorName?: string | null;
  interiorContractorName?: string | null;
  mainConsultantName?: string | null;
  interiorConsultantName?: string | null;
  endClientName?: string | null;
  endClientPhone?: string | null;
  endClientEmail?: string | null;
  endClientAddressLine1?: string | null;
  endClientAddressLine2?: string | null;
  endClientCity?: string | null;
  endClientState?: string | null;
  endClientGstNumber?: string | null;
}

export interface ListProjectsParams {
  /** "mine" = current user's own; "all" = scoped by role (see below). */
  scope: "mine" | "all";
  /** Full-text search across project name and external company name. */
  search?: string;
  /** Earliest createdAt to include (inclusive). */
  dateFrom?: Date;
  /** Latest createdAt to include (inclusive). */
  dateTo?: Date;
  /** 1-based page number. */
  page: number;
  /** Records per page. */
  pageSize: number;
  /**
   * Additional external-company filter for internal users viewing "All" scope.
   * When set, narrows results to projects with this externalCompanyId, within
   * the session's org. Ignored for external users (they're already scoped to
   * their own company by the scope=all condition).
   */
  externalCompanyId?: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all projects for the session org, newest-first.
 * Includes externalCompany name (nullable) for the list table.
 *
 * @deprecated Use listProjectsPaginated for all new callers.
 */
export async function listProjects(session: SessionData) {
  return prisma.project.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    // configSnapshot is 3-30 KB/row and never needed in lists (Stage 22 B3, D-10).
    omit: { configSnapshot: true },
    include: {
      externalCompany: { select: { id: true, name: true } },
    },
  });
}

/**
 * Paginated, filtered project list with RBAC visibility rules.
 *
 * Visibility rules (enforced server-side from session — never from URL params):
 *   scope="mine"  — always filters to createdByUserId = session.userId
 *   scope="all"   — external user (externalCompanyId != null): own company only
 *                 — internal user (externalCompanyId === null): full org scope
 *
 * Returns { projects, total } — total is the count before pagination, used
 * by the caller to compute page count.
 *
 * Tenancy: organizationId always scoped to session.organizationId.
 */
// Extract Prisma's ProjectWhereInput type without explicitly importing from @prisma/client.
// NonNullable strips the `| undefined` from the optional `where` property.
type ProjectWhereInput = NonNullable<
  NonNullable<Parameters<typeof prisma.project.findMany>[0]>["where"]
>;

export async function listProjectsPaginated(
  session: SessionData,
  params: ListProjectsParams,
) {
  const { scope, search, dateFrom, dateTo, page, pageSize } = params;

  // Build AND conditions incrementally to keep the where clause type-safe
  // without explicitly importing Prisma namespace types.
  const andConditions: ProjectWhereInput[] = [
    { organizationId: session.organizationId },
  ];

  // Scope: my own vs. role-scoped "all"
  if (scope === "mine") {
    andConditions.push({ createdByUserId: session.userId });
  } else if (session.externalCompanyId !== null) {
    // External user: "all" = only their external company's projects.
    // Value from server-side session — cannot be spoofed by URL params.
    andConditions.push({ externalCompanyId: session.externalCompanyId });
  }
  // Internal user + scope=all: no extra condition — sees all org projects.

  // Optional external-company filter — internal users only.
  // Narrows within the org; never replaces the org-level scope above.
  // Ignored for external users (their externalCompanyId is already enforced above).
  if (params.externalCompanyId && session.externalCompanyId === null) {
    andConditions.push({ externalCompanyId: params.externalCompanyId });
  }

  // Date range filter on createdAt
  if (dateFrom || dateTo) {
    andConditions.push({
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  // Full-text search across name and external company name
  if (search && search.trim()) {
    andConditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { externalCompany: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where: ProjectWhereInput = { AND: andConditions };

  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      // configSnapshot is 3-30 KB/row and never needed in lists (Stage 22 B3, D-10).
      omit: { configSnapshot: true },
      include: {
        externalCompany: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return { projects, total };
}

/**
 * Get a single project by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 *
 * Stage 19 Batch 4: also returns selectionCount and partitionCount for
 * wizard step-gating. The three queries run in parallel via Promise.all.
 * Tenancy on partitionCount is derived: projectId is already scoped to
 * session.organizationId by the findFirst, so the Partition→Room→Floor→Project
 * traversal cannot reach a different org's data.
 */
export async function getProjectById(
  session: SessionData,
  projectId: string,
  // Stage 22 B3 (D-10): configSnapshot is omitted by default; only the callers
  // that read the snapshot (Configuration page, B5) opt in.
  options: { includeConfigSnapshot?: boolean } = {},
) {
  const [project, selectionCount, partitionCount] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      // configSnapshot: true only when asked for — needed for Configuration page snapshot reads.
      omit: { configSnapshot: !options.includeConfigSnapshot },
      include: {
        externalCompany: { select: { id: true, name: true, country: true } },
        createdBy: { select: { id: true, username: true } },
        // Pull the linked inquiry's human-readable display numbers so the detail
        // and edit pages can show "INQ-42" / "#7" instead of a raw CUID2 FK.
        inquiry: { select: { inquiryNumber: true, companyInquiryNumber: true } },
      },
    }),
    prisma.selection.count({
      where: { projectId, organizationId: session.organizationId },
    }),
    prisma.partition.count({
      where: { room: { floor: { projectId, project: { organizationId: session.organizationId } } } },
    }),
  ]);

  if (!project) return null;
  return { ...project, selectionCount, partitionCount };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  name?: string;
  // destinationCountry is derived at create time and never updated (company is locked).
  currency?: string;
  projectLocation?: string | null;
  // externalCompanyId is intentionally absent — it is never updatable after creation.
  // Stage 14 Batch A — extended intake fields
  submissionDate?: Date | null;
  projectDeadline?: Date | null;
  projectBudget?: string | null;
  mainContractorName?: string | null;
  interiorContractorName?: string | null;
  mainConsultantName?: string | null;
  interiorConsultantName?: string | null;
  endClientName?: string | null;
  endClientPhone?: string | null;
  endClientEmail?: string | null;
  endClientAddressLine1?: string | null;
  endClientAddressLine2?: string | null;
  endClientCity?: string | null;
  endClientState?: string | null;
  endClientGstNumber?: string | null;
}

/**
 * Create a new project scoped to the session org.
 *
 * `projectNumber` is assigned as MAX(projectNumber) + 1 within the org, inside a
 * transaction. The @@unique([organizationId, projectNumber]) DB constraint is the
 * real guard against concurrent creates duplicating a number — a P2002 on that
 * pair is surfaced as a { code: "SEQUENCE_CONFLICT" } error.
 *
 * When `externalCompanyId` is resolved to a non-null value, `companyProjectNumber`
 * is additionally assigned as MAX(companyProjectNumber) + 1 scoped to that company,
 * inside the same transaction. The @@unique([externalCompanyId, companyProjectNumber])
 * DB constraint guards against concurrent per-company race collisions (also P2002 →
 * SEQUENCE_CONFLICT). When no company is linked, `companyProjectNumber` is left null.
 *
 * Also verifies `externalCompanyId` (if given) belongs to the session's org before
 * inserting, to prevent cross-tenant references.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on a projectNumber or companyProjectNumber
 * race collision, or { code: "INVALID_EXTERNAL_COMPANY" } if externalCompanyId
 * doesn't resolve within the org. All other errors propagate to the caller.
 */
export async function createProject(
  session: SessionData,
  input: CreateProjectInput,
) {
  // Defense in depth: if the session user is tied to a fixed company,
  // always use that — ignore whatever the client submitted.  Only when
  // session.externalCompanyId is null does the caller-supplied value apply.
  const resolvedExternalCompanyId =
    session.externalCompanyId !== null
      ? session.externalCompanyId
      : (input.externalCompanyId ?? null);

  try {
    return await prisma.$transaction(async (tx) => {
      // D19 (Stage 14 Batch C): destinationCountry is derived from the linked
      // company's country enum. INDIA → "India", UAE → "UAE". No company → "".
      let destinationCountry = "";
      if (resolvedExternalCompanyId) {
        const company = await tx.externalCompany.findFirst({
          where: { id: resolvedExternalCompanyId, organizationId: session.organizationId },
          select: { id: true, country: true },
        });
        if (!company) {
          throw Object.assign(new Error("External company not found."), {
            code: "INVALID_EXTERNAL_COMPANY",
          });
        }
        destinationCountry = company.country === "INDIA" ? "India" : "UAE";
      }

      // Org-wide sequence number (existing pattern)
      const orgMax = await tx.project.aggregate({
        where: { organizationId: session.organizationId },
        _max: { projectNumber: true },
      });
      const projectNumber = (orgMax._max.projectNumber ?? 0) + 1;

      // Per-company sequence number — only when a company is linked
      let companyProjectNumber: number | null = null;
      if (resolvedExternalCompanyId) {
        const companyMax = await tx.project.aggregate({
          where: { externalCompanyId: resolvedExternalCompanyId },
          _max: { companyProjectNumber: true },
        });
        companyProjectNumber = (companyMax._max.companyProjectNumber ?? 0) + 1;
      }

      // Stage 22 B4: freeze the org's ComponentType config in the SAME tx as the Project row (write-once;
      // no update path touches configSnapshot). A load failure aborts the create — no null-snapshot project.
      const configSnapshot = await loadConfigSnapshot(tx, session.organizationId);
      // Stage 23 B3 (D-21/D-22): pin the org's active formula set in the same tx, after the 13a structural
      // check against the snapshot just loaded. Throws FormulaPinError (-> 409) and aborts the create.
      const formulaSetId = await resolveFormulaSetPin(tx, session.organizationId, configSnapshot);

      return tx.project.create({
        // Never echo the snapshot in the create response (Stage 22 B3).
        omit: { configSnapshot: true },
        data: {
          configSnapshot: configSnapshot as unknown as Prisma.InputJsonValue,
          formulaSetId,
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          projectNumber,
          companyProjectNumber,
          name: input.name,
          destinationCountry,
          currency: input.currency,
          projectLocation: input.projectLocation ?? null,
          status: input.status,
          externalCompanyId: resolvedExternalCompanyId,
          // Stage 14 Batch A — extended intake fields
          submissionDate: input.submissionDate ?? null,
          projectDeadline: input.projectDeadline ?? null,
          projectBudget: input.projectBudget ?? null,
          mainContractorName: input.mainContractorName ?? null,
          interiorContractorName: input.interiorContractorName ?? null,
          mainConsultantName: input.mainConsultantName ?? null,
          interiorConsultantName: input.interiorConsultantName ?? null,
          endClientName: input.endClientName ?? null,
          endClientPhone: input.endClientPhone ?? null,
          endClientEmail: input.endClientEmail ?? null,
          endClientAddressLine1: input.endClientAddressLine1 ?? null,
          endClientAddressLine2: input.endClientAddressLine2 ?? null,
          endClientCity: input.endClientCity ?? null,
          endClientState: input.endClientState ?? null,
          endClientGstNumber: input.endClientGstNumber ?? null,
        },
      });
    });
  } catch (err) {
    // P2002 on (organizationId, projectNumber) or (externalCompanyId, companyProjectNumber)
    // = concurrent race collision on either sequence
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(new Error("Project number conflict — please try again."), {
        code: "SEQUENCE_CONFLICT",
      });
    }
    throw err;
  }
}

/**
 * Update editable fields on an existing project.
 *
 * Only DRAFT projects are editable — callers must check status before calling,
 * but this function also enforces it server-side (returns null on wrong status
 * so the route handler can surface a 409).
 *
 * `externalCompanyId` is never included in the update — the field is locked for
 * the life of the record so the per-company sequence never needs recomputing.
 *
 * Tenancy: scoped by organizationId from the session — a project belonging to a
 * different org will not be found and null is returned.
 *
 * Returns the updated project, or null if the project does not exist, belongs to
 * a different org, or is not in DRAFT status.
 */
export async function updateProject(
  session: SessionData,
  projectId: string,
  input: UpdateProjectInput,
) {
  // Verify the project exists, belongs to this org, and is still DRAFT.
  const existing = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    select: { id: true, status: true },
  });

  if (!existing) return null;
  if (existing.status !== "DRAFT") return { notEditable: true as const };

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      // destinationCountry is derived at create time and never updated (D19).
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.projectLocation !== undefined
        ? { projectLocation: input.projectLocation }
        : {}),
      // Stage 14 Batch A — extended intake fields
      ...(input.submissionDate !== undefined ? { submissionDate: input.submissionDate } : {}),
      ...(input.projectDeadline !== undefined ? { projectDeadline: input.projectDeadline } : {}),
      ...(input.projectBudget !== undefined ? { projectBudget: input.projectBudget } : {}),
      ...(input.mainContractorName !== undefined ? { mainContractorName: input.mainContractorName } : {}),
      ...(input.interiorContractorName !== undefined ? { interiorContractorName: input.interiorContractorName } : {}),
      ...(input.mainConsultantName !== undefined ? { mainConsultantName: input.mainConsultantName } : {}),
      ...(input.interiorConsultantName !== undefined ? { interiorConsultantName: input.interiorConsultantName } : {}),
      ...(input.endClientName !== undefined ? { endClientName: input.endClientName } : {}),
      ...(input.endClientPhone !== undefined ? { endClientPhone: input.endClientPhone } : {}),
      ...(input.endClientEmail !== undefined ? { endClientEmail: input.endClientEmail } : {}),
      ...(input.endClientAddressLine1 !== undefined ? { endClientAddressLine1: input.endClientAddressLine1 } : {}),
      ...(input.endClientAddressLine2 !== undefined ? { endClientAddressLine2: input.endClientAddressLine2 } : {}),
      ...(input.endClientCity !== undefined ? { endClientCity: input.endClientCity } : {}),
      ...(input.endClientState !== undefined ? { endClientState: input.endClientState } : {}),
      ...(input.endClientGstNumber !== undefined ? { endClientGstNumber: input.endClientGstNumber } : {}),
    },
    // Never echo the snapshot in the update response (Stage 22 B3).
    omit: { configSnapshot: true },
    include: {
      externalCompany: { select: { id: true, name: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });

  return { project: updated };
}

// ─── buildMaterialsInput — local helper ────────────────────────────────────

/**
 * Build a `MaterialsInput` from a `CalculationLoad`, merging room topology (isClosed, sides)
 * from `loaded.roomTopology` into the floors structure. Also populates `roomLabels` and
 * `partitionLabels` maps (passed by reference — both maps are built as a side-effect here).
 *
 * Pure function — no DB access, no Prisma.
 */
function buildMaterialsInputHelper(
  loaded: CalculationLoad,
  roomLabels: Map<string, string>,
  partitionLabels: Map<string, string>,
): MaterialsInput {
  return {
    formulaSetBody: loaded.input.formulaSetBody,
    snapshot: loaded.input.snapshot,
    floors: loaded.input.floors.map((f) => ({
      id: f.id,
      label: f.label,
      rooms: f.rooms.map((r) => {
        roomLabels.set(r.id, r.label);
        const topo = loaded.roomTopology.get(r.id);
        r.partitions.forEach((p) => partitionLabels.set(p.id, p.label));
        return {
          id: r.id,
          label: r.label,
          isClosed: topo?.isClosed ?? true,
          // Cast: sides is Prisma.JsonValue at runtime but carries valid RoomSide[] data
          // (app-code validated on write; schema guarantees the column is jsonb).
          sides: (topo?.sides ?? []) as unknown as RoomSide[],
          partitions: r.partitions.map((p) => ({
            id: p.id,
            label: p.label,
            widthMm: p.widthMm,
            heightMm: p.heightMm,
            design: p.design,
          })),
        };
      }),
    })),
    selections: loaded.input.selections.map((s) => ({
      id: s.id,
      componentTypeId: s.componentTypeId,
      config: s.config,
    })),
  };
}

// ─── Submit Design ──────────────────────────────────────────────────────────

/**
 * Mark a Project's design as submitted — the gate that unlocks the Summary and Quotation wizard
 * steps (previously auto-unlocked at partitionCount>0; now requires this explicit action).
 *
 * Stage 23 Batch 5: also builds and writes the project's ProjectCalculation (Summary) in the same
 * transaction as the stamp.
 *
 * Stage 24 Batch 5: the old `checkDesignReadyForSubmit` / `buildFailed` paths are replaced by a
 * two-phase gate:
 *   Phase A (runPhaseA) — structural: every cell must have a resolving Selection with a known
 *     componentType. If any problem → return `calculationRefused`, nothing written.
 *   Phase B — material: buildSummary + buildMaterials + resolveAndAggregate share one collector.
 *     If any problem → return `calculationRefused`, nothing written.
 *   Write — reached only when BOTH collectors are empty (exactly one call to writeCalculation).
 *   An unexpected FAILED from buildSummary after Phase A passes → throws (→ 500, no write).
 *
 * Requires at least one Partition — submitting an empty design isn't meaningful.
 *
 * Returns null if the project doesn't exist or belongs to a different org.
 * Returns { noPartitions: true } if the project has zero Partitions.
 * Returns { noFormulaSet: true } if the project has no pinned formula set or config snapshot.
 * Returns { calculationRefused: CalculationProblemReport } if Phase A or Phase B has problems.
 * Returns { project } on success.
 */
export type SubmitDesignResult =
  | null
  | { noPartitions: true }
  | { noFormulaSet: true }
  | { calculationRefused: CalculationProblemReport }
  | { project: { id: string; designSubmittedAt: Date | null } };

export async function submitDesign(
  session: SessionData,
  projectId: string,
): Promise<SubmitDesignResult> {
  return prisma.$transaction(async (tx): Promise<SubmitDesignResult> => {
    const existing = await tx.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!existing) return null;

    const partitionCount = await tx.partition.count({
      where: { room: { floor: { projectId, project: { organizationId: session.organizationId } } } },
    });
    if (partitionCount === 0) return { noPartitions: true as const };

    const loaded = await loadCalculationInput(tx, session.organizationId, projectId);
    if (!loaded) return null; // shouldn't happen — existing was just re-checked in this tx
    if (!loaded.project.formulaSetId || loaded.input.snapshot.takenAt === "") {
      return { noFormulaSet: true as const };
    }

    const inventoryMap = await loadInventoryMap(tx, session.organizationId);

    // ── Phase A (structural) ────────────────────────────────────────────────
    const phaseACollector = new ProblemCollector();
    runPhaseA(
      loaded.input.floors,
      loaded.input.selections,
      loaded.input.snapshot,
      phaseACollector,
    );
    if (phaseACollector.hasAny()) {
      return { calculationRefused: phaseACollector.report() }; // ← exit 1: nothing written
    }

    // ── Phase B (material) ──────────────────────────────────────────────────
    const result = buildSummary(loaded.input);
    if (result.status === "FAILED") {
      // buildSummary can fail on semantic errors Phase A cannot detect:
      //   • a blank required summary field (e.g. GLASS.glassType) on a Selection
      //   • a ComponentType whose code has no slot in the pinned formula set
      // These are user-data problems, not internal bugs. Route through the 422 envelope
      // (MISSING_PARAM, SELECTION scope) so the UI shows the actual reason. The throw-as-500
      // backstop in catch() below still covers any genuinely unexpected errors.
      const failedCollector = new ProblemCollector();
      failedCollector.add({
        kind: "MISSING_PARAM",
        scope: "SELECTION",
        message: result.errorDetail ?? "Design summary could not be built — a required field or slot is missing",
      });
      return { calculationRefused: failedCollector.report() }; // ← exit 2a: nothing written
    }

    const roomLabels = new Map<string, string>();
    const partitionLabels = new Map<string, string>();
    const materialsInput = buildMaterialsInputHelper(loaded, roomLabels, partitionLabels);
    const { rawLines, byRoom, collector } = buildMaterials(materialsInput);
    const materialList = resolveAndAggregate(rawLines, inventoryMap, collector, roomLabels, partitionLabels);

    if (collector.hasAny()) {
      return { calculationRefused: collector.report() }; // ← exit 2b: nothing written
    }

    // ── Write (exactly one path — only reachable when both collectors are empty) ──
    await writeCalculation(
      tx,
      session.organizationId,
      projectId,
      loaded.project.formulaSetId,
      result,
      materialList,
      byRoom,
    );

    const updated = await tx.project.update({
      where: { id: projectId },
      data: { designSubmittedAt: new Date() },
      select: { id: true, designSubmittedAt: true },
    });

    return { project: updated };
  });
}

/**
 * Recompute a Project's ProjectCalculation (Stage 23 Batch 5, D-23). Re-runs the same shared
 * load-summary-write path as submitDesign() but:
 *   - is gated to DRAFT projects that have EITHER a designSubmittedAt OR an existing calculation —
 *     recompute is never the FIRST computation (D-23);
 *   - never touches designSubmittedAt.
 *
 * Stage 24 Batch 5: same two-phase gate as submitDesign(). If either phase emits problems, the
 * stored row is left UNTOUCHED (computedAt, materialList, materialByRoom, designSubmittedAt all
 * unchanged). This satisfies G-3: a recompute refusal is NOT a D-17…D-20 invalidation event —
 * the stored calculation row is not written at all on a refused pass.
 *
 * Returns null if the project doesn't exist or belongs to a different org (-> 404).
 * Returns { notDraft: true } if the project isn't DRAFT (-> 409).
 * Returns { neverComputed: true } if neither designSubmittedAt nor a prior calculation exists (-> 409).
 * Returns { noFormulaSet: true } if the project has no pinned formula set (defensive, -> 409).
 * Returns { calculationRefused: CalculationProblemReport } if Phase A or Phase B has problems (→ 422).
 * Returns { calculation } on success.
 */
type ProjectCalculationRow = Awaited<
  ReturnType<typeof prisma.projectCalculation.findUniqueOrThrow>
>;

export type RecomputeProjectResult =
  | null
  | { notDraft: true }
  | { neverComputed: true }
  | { noFormulaSet: true }
  | { calculationRefused: CalculationProblemReport }
  | { calculation: ProjectCalculationRow };

export async function recomputeProject(
  session: SessionData,
  projectId: string,
): Promise<RecomputeProjectResult> {
  return prisma.$transaction(async (tx): Promise<RecomputeProjectResult> => {
    const existing = await tx.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true, status: true, designSubmittedAt: true },
    });
    if (!existing) return null;
    if (existing.status !== "DRAFT") return { notDraft: true as const };

    const priorCalculation = await tx.projectCalculation.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (existing.designSubmittedAt === null && !priorCalculation) {
      return { neverComputed: true as const };
    }

    const loaded = await loadCalculationInput(tx, session.organizationId, projectId);
    if (!loaded) return null; // shouldn't happen — existing was just re-checked in this tx
    if (!loaded.project.formulaSetId) return { noFormulaSet: true as const };

    const inventoryMap = await loadInventoryMap(tx, session.organizationId);

    // ── Phase A (structural) ────────────────────────────────────────────────
    const phaseACollector = new ProblemCollector();
    runPhaseA(
      loaded.input.floors,
      loaded.input.selections,
      loaded.input.snapshot,
      phaseACollector,
    );
    if (phaseACollector.hasAny()) {
      return { calculationRefused: phaseACollector.report() }; // ← exit 1: stored row UNTOUCHED
    }

    // ── Phase B (material) ──────────────────────────────────────────────────
    const result = buildSummary(loaded.input);
    if (result.status === "FAILED") {
      // Same semantic-error cases as submitDesign — route through 422 envelope, no write.
      // The stored row is left UNTOUCHED (satisfies G-3 for recompute).
      const failedCollector = new ProblemCollector();
      failedCollector.add({
        kind: "MISSING_PARAM",
        scope: "SELECTION",
        message: result.errorDetail ?? "Design summary could not be built — a required field or slot is missing",
      });
      return { calculationRefused: failedCollector.report() }; // ← exit 2a: stored row UNTOUCHED
    }

    const roomLabels = new Map<string, string>();
    const partitionLabels = new Map<string, string>();
    const materialsInput = buildMaterialsInputHelper(loaded, roomLabels, partitionLabels);
    const { rawLines, byRoom, collector } = buildMaterials(materialsInput);
    const materialList = resolveAndAggregate(rawLines, inventoryMap, collector, roomLabels, partitionLabels);

    if (collector.hasAny()) {
      return { calculationRefused: collector.report() }; // ← exit 2b: stored row UNTOUCHED
    }

    // ── Write (exactly one path — only reachable when both collectors are empty) ──
    await writeCalculation(
      tx,
      session.organizationId,
      projectId,
      loaded.project.formulaSetId,
      result,
      materialList,
      byRoom,
    );

    const calculation = await tx.projectCalculation.findUniqueOrThrow({ where: { projectId } });
    return { calculation };
  });
}

/**
 * Delete a DRAFT Project and all its children in a FK-safe transaction.
 *
 * Guards:
 *   - Returns null if the project does not exist or belongs to a different org
 *     (caller -> 404).
 *   - Returns { notDeletable: true } if the project exists but is not DRAFT
 *     (caller -> 409).
 *
 * If this was the last Project linked to an Inquiry, the Inquiry is reverted
 * to "NEW" status inside the same transaction (the delete-side counterpart to
 * convertInquiry's one-way "already CONVERTED" guard).
 *
 * FK-safe deletion order (children before parents):
 *   1. Selection  — references Project (FK_RESTRICT)
 *   2. Room       — references Floor (Cascade from Floor, but explicit for
 *                   belt-and-braces: a Room with this org's organizationId but
 *                   whose Floor is gone would otherwise abort on FK_RESTRICT)
 *   3. Floor      — references Project (FK_RESTRICT)
 *   4. ProjectCalculation — Cascade from Project, explicit first (Stage 23 D-20)
 *   5. Project    — the row itself
 * Partition rows cascade automatically when their Room is deleted (DB FK).
 */
export async function deleteProject(session: SessionData, projectId: string) {
  // Prisma interactive transactions don't support early-returning the outer
  // function from inside the callback, so we use boolean flags set inside the
  // closure and act on them after the transaction settles.  TypeScript can type
  // the three explicit return statements below correctly; a typed union variable
  // would confuse narrowing at the call site.
  let found = false;
  let isDraft = false;

  await prisma.$transaction(async (tx) => {
    // Re-check existence and DRAFT status INSIDE the transaction to close the
    // TOCTOU window: a concurrent PATCH could promote the project off DRAFT
    // between an outer findFirst and the delete below.
    const existing = await tx.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true, status: true, inquiryId: true },
    });

    if (!existing) return; // found stays false
    found = true;

    if (existing.status !== "DRAFT") return; // isDraft stays false
    isDraft = true;

    const { inquiryId } = existing;

    // Optional: revert Inquiry to NEW if this was its last project.
    if (inquiryId) {
      const remainingCount = await tx.project.count({
        where: {
          inquiryId,
          organizationId: session.organizationId,
          id: { not: projectId },
        },
      });
      if (remainingCount === 0) {
        await tx.inquiry.update({
          where: { id: inquiryId },
          data: { status: "NEW" },
        });
      }
    }

    // 1. Selections — references Project (RESTRICT)
    await tx.selection.deleteMany({
      where: { projectId, organizationId: session.organizationId },
    });

    // 2. Rooms — references Floor (Cascade, but explicit belt-and-braces per
    //    the precedent in lib/data/superadmin/orgs.ts FK-safe ordering)
    await tx.room.deleteMany({
      where: {
        floor: { projectId },
        organizationId: session.organizationId,
      },
    });

    // 3. Floors — references Project (RESTRICT); Rooms/Partitions already gone
    await tx.floor.deleteMany({
      where: { projectId, organizationId: session.organizationId },
    });

    // 4. ProjectCalculation — Cascade from Project at the DB, but explicit first (Stage 23 D-20)
    await tx.projectCalculation.deleteMany({
      where: { projectId, organizationId: session.organizationId },
    });

    // 5. Project itself
    await tx.project.delete({ where: { id: projectId }, select: { id: true } });
  });

  if (!found) return null;
  if (!isDraft) return { notDeletable: true as const };
  return { id: projectId };
}
