/**
 * External-company delete guard text (Stage 31 S31-5). Pure, so the 409 message is unit-testable.
 *
 * A company that still has users (active or deactivated), projects or inquiries cannot be deleted:
 * the route answers 409 `COMPANY_HAS_RECORDS` with this message. Only non-zero parts are listed.
 */
export const COMPANY_HAS_RECORDS_CODE = "COMPANY_HAS_RECORDS";

export type CompanyRecordCounts = { users: number; projects: number; inquiries: number };

export function companyHasRecords(c: CompanyRecordCounts): boolean {
  return c.users > 0 || c.projects > 0 || c.inquiries > 0;
}

export function companyHasRecordsMessage(c: CompanyRecordCounts): string {
  const parts: string[] = [];
  if (c.users > 0) parts.push(`${c.users} user(s)`);
  if (c.projects > 0) parts.push(`${c.projects} project(s)`);
  if (c.inquiries > 0) parts.push(`${c.inquiries} inquiry(ies)`);
  const list =
    parts.length <= 1
      ? parts.join("")
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This company still has ${list}. Reassign or remove them first.`;
}
