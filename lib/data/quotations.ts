/**
 * Quotation DAL (Stage 38 Batch 3, 38b). All pricing and totals math lives in the pure `lib/quotation/` module;
 * this file loads inputs, runs ONE transaction per mutation, and writes the result whole.
 *
 * Tenancy: every read starts from the ownership-filtered project (`ownedProjectWhere`, Hotfix 2026-10-05), so a
 * foreign or cross-company project id is "projectNotFound" (404), identical to a nonexistent one; every quotation
 * query also carries `organizationId`.
 * S38-3: every mutation locks the quotation row (`SELECT ... FOR UPDATE`, the same sanctioned raw-SQL call as
 * lib/data/user-limit.ts) and recomputes subtotal and grand total from `lines` + the stored inputs; totals are
 * never taken from the client. Create locks the PROJECT row instead (the quotation does not exist yet), which
 * closes the "one per project" check-then-insert race (projectId is deliberately not unique, S38-D2).
 * Price lookups are ONE `ItemPrice` query per action for the org's codes, never per line.
 * Reads never select `materialByRoom` (client-level omit) and there is no list-shaped read of `lines`.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ownedProjectWhere } from "@/lib/data/ownership";
import { withSequenceRetry } from "@/lib/sequence-retry";
import { centsToFixed, decimalToCents } from "@/lib/money";
import type { MissingPrice } from "@/lib/missing-prices";
import type { SessionData } from "@/lib/session";
import { checkDiscount, type QuotationInputPatch } from "@/lib/quotation/inputs";
import { anyLineEdited, buildLines, refreshLines, repriceLines, type LinesResult } from "@/lib/quotation/lines";
import { renewedValidUntil, validityFrom } from "@/lib/quotation/meta";
import { computeTotals, linesTotalOf } from "@/lib/quotation/totals";
import type { DiscountType, MaterialLineInput, PriceInfo, QuotationLine } from "@/lib/quotation/types";
import { rowLines, serializeQuotation, type QuotationRow, type QuotationView } from "@/lib/quotation/view";

type Tx = Prisma.TransactionClient;

const QUOTATION_SELECT = {
  id: true,
  projectId: true,
  externalCompanyId: true,
  quotationNumber: true,
  status: true,
  currency: true,
  lines: true,
  transport: true,
  otherCharges: true,
  discount: true,
  discountType: true,
  discountAppliedAt: true,
  taxPercent: true,
  subtotal: true,
  grandTotal: true,
  pricedAt: true,
  validUntil: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type QuotationOutcome =
  | { kind: "ok"; quotation: QuotationView }
  | { kind: "projectNotFound" }
  | { kind: "noQuotation" }
  | { kind: "noCalculation" }
  | { kind: "exists" }
  | { kind: "ordered" }
  | { kind: "needsApplyDiscount" }
  | { kind: "invalidInput"; error: string }
  | { kind: "missingPrices"; missing: MissingPrice[]; currency: string };

// ─── loaders ────────────────────────────────────────────────────────────────────────────────────────────

async function ownedProject(db: Tx | typeof prisma, session: SessionData, projectId: string) {
  return db.project.findFirst({
    where: { id: projectId, ...ownedProjectWhere(session) },
    select: { id: true, currency: true, externalCompanyId: true },
  });
}

/** The project's calculation, or null when it has none or it did not finish OK ("Submit the design first"). */
async function loadCalc(db: Tx | typeof prisma, organizationId: string, projectId: string) {
  const calc = await db.projectCalculation.findFirst({
    where: { projectId, organizationId },
    select: { computedAt: true, status: true, materialList: true },
  });
  return calc;
}

function toMaterialInputs(json: unknown): MaterialLineInput[] {
  if (!Array.isArray(json)) return [];
  const out: MaterialLineInput[] = [];
  for (const l of json as Array<Record<string, unknown>>) {
    if (typeof l?.code !== "string" || typeof l.quantity !== "number") continue;
    out.push({
      code: l.code,
      name: typeof l.name === "string" ? l.name : l.code,
      slot: (Array.isArray(l.slot) || typeof l.slot === "string" ? l.slot : "") as string | string[],
      unit: typeof l.unit === "string" ? l.unit : "",
      quantity: l.quantity,
    });
  }
  return out;
}

/** One org-scoped ItemPrice query for the codes in `currency`, as integer cents. */
async function loadPrices(db: Tx | typeof prisma, organizationId: string, currency: string, codes: string[]): Promise<Map<string, PriceInfo>> {
  const map = new Map<string, PriceInfo>();
  const unique = [...new Set(codes)];
  if (unique.length === 0) return map;
  const rows = await db.itemPrice.findMany({
    where: { organizationId, currency, inventoryItem: { code: { in: unique } } },
    select: { price: true, minPrice: true, allowAbove: true, inventoryItem: { select: { code: true } } },
  });
  for (const r of rows) {
    const price = decimalToCents(r.price);
    const minPrice = decimalToCents(r.minPrice);
    if (price === null || minPrice === null) continue; // not representable in 2 dp: treated as unpriced
    map.set(r.inventoryItem.code, { price, minPrice, allowAbove: r.allowAbove });
  }
  return map;
}

async function lockRow(tx: Tx, table: "Quotation" | "Project", id: string) {
  if (table === "Quotation") await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "id" = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
}

function viewOf(row: QuotationRow, projectCurrency: string, calcComputedAt: Date | null): QuotationView {
  return serializeQuotation(row, { projectCurrency, calcComputedAt, now: new Date() });
}

/** The values written whenever lines or inputs change: totals recomputed from them, never from the client. */
function totalsData(
  lines: ReadonlyArray<QuotationLine>,
  inputs: { transport: number; otherCharges: number; discountType: DiscountType; discount: number; taxHundredths: number },
) {
  const t = computeTotals({ lines, ...inputs });
  return { subtotal: centsToFixed(t.subtotal), grandTotal: centsToFixed(t.grandTotal) };
}

function currentInputs(row: QuotationRow) {
  return {
    transport: decimalToCents(row.transport) ?? 0,
    otherCharges: decimalToCents(row.otherCharges) ?? 0,
    discountType: row.discountType as DiscountType,
    discount: decimalToCents(row.discount) ?? 0,
    taxHundredths: decimalToCents(row.taxPercent) ?? 0,
  };
}

// ─── read ───────────────────────────────────────────────────────────────────────────────────────────────

/** GET: the stored quotation plus the live flags (design changed, currency differs, expired). Snapshot only. */
export async function getQuotation(session: SessionData, projectId: string): Promise<QuotationOutcome> {
  const project = await ownedProject(prisma, session, projectId);
  if (!project) return { kind: "projectNotFound" };
  const row = await prisma.quotation.findFirst({
    where: { projectId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
    select: QUOTATION_SELECT,
  });
  if (!row) return { kind: "noQuotation" };
  const calc = await prisma.projectCalculation.findFirst({
    where: { projectId, organizationId: session.organizationId },
    select: { computedAt: true },
  });
  return { kind: "ok", quotation: viewOf(row, project.currency, calc?.computedAt ?? null) };
}

// ─── create ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST create (Q-D6, S38-D1, S38-D2): every material-list line priced at the Inventory max in the project
 * currency. 404 / "exists" (409) / "noCalculation" (422) / "missingPrices" (422, nothing written). The number is
 * max + 1 per org; a unique-index collision is retried with a fresh transaction (withSequenceRetry).
 */
export function createQuotation(session: SessionData, projectId: string): Promise<QuotationOutcome> {
  return withSequenceRetry(() => createOnce(session, projectId));
}

async function createOnce(session: SessionData, projectId: string): Promise<QuotationOutcome> {
  const orgId = session.organizationId;
  try {
    return await prisma.$transaction(async (tx): Promise<QuotationOutcome> => {
      const project = await ownedProject(tx, session, projectId);
      if (!project) return { kind: "projectNotFound" };
      await lockRow(tx, "Project", project.id);

      if (await tx.quotation.findFirst({ where: { projectId, organizationId: orgId }, select: { id: true } })) {
        return { kind: "exists" };
      }
      const calc = await loadCalc(tx, orgId, projectId);
      if (!calc || calc.status !== "OK") return { kind: "noCalculation" };

      const list = toMaterialInputs(calc.materialList);
      const prices = await loadPrices(tx, orgId, project.currency, list.map((l) => l.code));
      const built = buildLines(list, prices);
      if (!built.ok) return { kind: "missingPrices", missing: built.missing, currency: project.currency };

      const max = await tx.quotation.aggregate({ where: { organizationId: orgId }, _max: { quotationNumber: true } });
      const now = new Date();
      const row = await tx.quotation.create({
        data: {
          organizationId: orgId,
          externalCompanyId: project.externalCompanyId,
          projectId,
          quotationNumber: (max._max.quotationNumber ?? 0) + 1,
          currency: project.currency,
          lines: built.lines as unknown as Prisma.InputJsonValue,
          ...totalsData(built.lines, { transport: 0, otherCharges: 0, discountType: "PERCENT", discount: 0, taxHundredths: 0 }),
          pricedAt: now,
          validUntil: validityFrom(now),
          createdByUserId: session.userId,
        },
        select: QUOTATION_SELECT,
      });
      return { kind: "ok", quotation: viewOf(row, project.currency, calc.computedAt) };
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      throw Object.assign(new Error("Quotation number conflict, please try again."), { code: "SEQUENCE_CONFLICT" });
    }
    throw err;
  }
}

// ─── mutations on an existing quotation ─────────────────────────────────────────────────────────────────

interface Locked {
  tx: Tx;
  row: QuotationRow;
  project: { id: string; currency: string };
}

/**
 * Shared frame of Refresh / Reset / Renew / PATCH: ownership-filtered project, the project's quotation, its row
 * locked (S38-3) and re-read AFTER the lock, ORDERED refused (409). `fn` runs inside the same transaction.
 */
async function withLockedQuotation(
  session: SessionData,
  projectId: string,
  fn: (l: Locked) => Promise<QuotationOutcome>,
): Promise<QuotationOutcome> {
  const orgId = session.organizationId;
  return prisma.$transaction(async (tx): Promise<QuotationOutcome> => {
    const project = await ownedProject(tx, session, projectId);
    if (!project) return { kind: "projectNotFound" };
    const found = await tx.quotation.findFirst({
      where: { projectId, organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!found) return { kind: "noQuotation" };
    await lockRow(tx, "Quotation", found.id);
    const row = await tx.quotation.findUniqueOrThrow({ where: { id: found.id }, select: QUOTATION_SELECT });
    if (row.status === "ORDERED") return { kind: "ordered" };
    return fn({ tx, row, project });
  });
}

async function finish(l: Locked, data: Prisma.QuotationUpdateInput): Promise<QuotationOutcome> {
  const row = await l.tx.quotation.update({ where: { id: l.row.id }, data, select: QUOTATION_SELECT });
  const calc = await l.tx.projectCalculation.findFirst({ where: { projectId: row.projectId }, select: { computedAt: true } });
  return { kind: "ok", quotation: viewOf(row, l.project.currency, calc?.computedAt ?? null) };
}

/**
 * POST refresh (Q-D10, Q-D15, Q-D35): quantities from the latest calculation; same currency keeps stored prices
 * and ranges (new codes at the current max, dropped codes drop); a currency change re-prices every line at the
 * current max, moves `currency` to the project's and zeroes a fixed discount. `pricedAt` = now, `validUntil`
 * untouched.
 */
export function refreshQuotation(session: SessionData, projectId: string): Promise<QuotationOutcome> {
  return withLockedQuotation(session, projectId, async (l) => {
    const calc = await loadCalc(l.tx, session.organizationId, projectId);
    if (!calc || calc.status !== "OK") return { kind: "noCalculation" };
    const list = toMaterialInputs(calc.materialList);
    const target = l.project.currency;
    const changed = l.row.currency !== target;
    const prices = await loadPrices(l.tx, session.organizationId, target, list.map((x) => x.code));
    const result: LinesResult = refreshLines(list, rowLines(l.row), prices, changed);
    if (!result.ok) return { kind: "missingPrices", missing: result.missing, currency: target };

    const inputs = currentInputs(l.row);
    const zeroFixed = changed && inputs.discountType === "FIXED";
    if (zeroFixed) inputs.discount = 0;
    return finish(l, {
      lines: result.lines as unknown as Prisma.InputJsonValue,
      currency: target,
      pricedAt: new Date(),
      ...(zeroFixed ? { discount: 0 } : {}),
      ...totalsData(result.lines, inputs),
    });
  });
}

/**
 * POST reset-prices (Q-D15, Q-D33): the STORED quantities re-priced at the current Inventory values in the
 * quotation's currency; edits discarded; `pricedAt` = now and `validUntil` restarted. Gate: QUOTE (route) while no
 * line is edited, APPLY_DISCOUNT once any line is (`canApplyDiscount`, decided by the route).
 */
export function resetQuotationPrices(session: SessionData, projectId: string, canApplyDiscount: boolean): Promise<QuotationOutcome> {
  return withLockedQuotation(session, projectId, async (l) => {
    const lines = rowLines(l.row);
    if (anyLineEdited(lines) && !canApplyDiscount) return { kind: "needsApplyDiscount" };
    const prices = await loadPrices(l.tx, session.organizationId, l.row.currency, lines.map((x) => x.code));
    const result = repriceLines(lines, prices);
    if (!result.ok) return { kind: "missingPrices", missing: result.missing, currency: l.row.currency };
    const now = new Date();
    return finish(l, {
      lines: result.lines as unknown as Prisma.InputJsonValue,
      pricedAt: now,
      validUntil: validityFrom(now),
      ...totalsData(result.lines, currentInputs(l.row)),
    });
  });
}

/** POST renew (Q-D18, Q-D20): `validUntil` + 30 days from the later of now and the current expiry; no repricing. */
export function renewQuotation(session: SessionData, projectId: string): Promise<QuotationOutcome> {
  return withLockedQuotation(session, projectId, (l) =>
    finish(l, { validUntil: renewedValidUntil(l.row.validUntil, new Date()) }),
  );
}

/**
 * PATCH the money inputs (S38-D4, Q-D33). A TYPED discount (discount or discountType in the patch) must fit the
 * resulting subtotal (a fixed amount above it is refused, 400, nothing written); a stored one is only capped on
 * recompute (S38-7). Totals are recomputed here.
 */
export function updateQuotationInputs(
  session: SessionData,
  projectId: string,
  patch: QuotationInputPatch,
): Promise<QuotationOutcome> {
  return withLockedQuotation(session, projectId, async (l) => {
    const cur = currentInputs(l.row);
    const next = {
      transport: patch.transport ?? cur.transport,
      otherCharges: patch.otherCharges ?? cur.otherCharges,
      discountType: patch.discountType ?? cur.discountType,
      discount: patch.discount ?? cur.discount,
      taxHundredths: patch.taxHundredths ?? cur.taxHundredths,
    };
    const lines = rowLines(l.row);
    const typed = patch.discount !== undefined || patch.discountType !== undefined;
    if (typed) {
      const subtotal = linesTotalOf(lines) + next.transport + next.otherCharges;
      const error = checkDiscount(next.discountType, next.discount, subtotal);
      if (error) return { kind: "invalidInput", error };
    }
    return finish(l, {
      transport: centsToFixed(next.transport),
      otherCharges: centsToFixed(next.otherCharges),
      discountType: next.discountType,
      discount: centsToFixed(next.discount),
      taxPercent: centsToFixed(next.taxHundredths),
      ...(typed ? { discountAppliedByUserId: session.userId, discountAppliedAt: new Date() } : {}),
      ...totalsData(lines, next),
    });
  });
}

