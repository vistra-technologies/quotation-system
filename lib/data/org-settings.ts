import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

/** The session org's settings (Stage 38). Scoped by session.organizationId, never a client id. */
export async function getOrgSettings(session: SessionData) {
  return prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { defaultCurrency: true },
  });
}

/** Set the session org's default currency (caller validated it with isSupportedCurrency). */
export async function updateOrgDefaultCurrency(session: SessionData, defaultCurrency: string) {
  return prisma.organization.update({
    where: { id: session.organizationId },
    data: { defaultCurrency },
    select: { defaultCurrency: true },
  });
}
