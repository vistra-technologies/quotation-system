"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { createFloorIfNotExists } from "@/lib/data/floors";
import { createPartition } from "@/lib/data/partitions";

// ---------------------------------------------------------------------------
// createWall
// ---------------------------------------------------------------------------

export type CreateWallState = { error: string | null };

/**
 * Server action: create a new wall (Partition) under a floor.
 *
 * Unit normalisation (before the DAL call):
 *   mm   → Math.round(value)
 *   feet → Math.round(value * 304.8)
 *
 * Floor handling: the floor label is free text. If it matches an existing
 * Floor for the project it is reused; otherwise a new Floor row is created.
 * This is implemented by createFloorIfNotExists in lib/data/floors.ts.
 *
 * On success: revalidates the design page and redirects back to it.
 */
export async function createWall(
  prevState: CreateWallState,
  formData: FormData,
): Promise<CreateWallState> {
  const orgSlug = (formData.get("orgSlug") as string | null)?.trim() ?? "";
  const projectId = (formData.get("projectId") as string | null)?.trim() ?? "";
  const location = (formData.get("location") as string | null)?.trim();
  const floorLabel = (formData.get("floorLabel") as string | null)?.trim();
  const heightRaw = formData.get("height") as string | null;
  const widthRaw = formData.get("width") as string | null;
  const unitH = (formData.get("unit_h") as string | null) ?? "mm";
  const unitW = (formData.get("unit_w") as string | null) ?? "mm";

  // Validate required fields.
  if (!location) return { error: "Location is required." };
  if (!floorLabel) return { error: "Floor label is required." };
  if (!heightRaw || isNaN(Number(heightRaw)) || Number(heightRaw) <= 0) {
    return { error: "Height must be a positive number." };
  }
  if (!widthRaw || isNaN(Number(widthRaw)) || Number(widthRaw) <= 0) {
    return { error: "Width must be a positive number." };
  }

  // Unit normalisation.
  const heightMm =
    unitH === "feet"
      ? Math.round(Number(heightRaw) * 304.8)
      : Math.round(Number(heightRaw));
  const widthMm =
    unitW === "feet"
      ? Math.round(Number(widthRaw) * 304.8)
      : Math.round(Number(widthRaw));

  const session = await requireSession(orgSlug);

  // Verify the project belongs to the session's org — prevents cross-org Floor
  // creation via a direct POST with a foreign projectId (client-supplied value).
  const project = await getProjectById(session, projectId);
  if (!project) return { error: "Project not found." };

  // Resolve or create the floor (idempotent by label within the project).
  let floor;
  try {
    floor = await createFloorIfNotExists(
      projectId,
      floorLabel,
      session.organizationId,
    );
  } catch {
    return { error: "Failed to resolve floor — please try again." };
  }

  // Create the partition.
  try {
    await createPartition({
      floorId: floor.id,
      location,
      heightMm,
      widthMm,
      organizationId: session.organizationId,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return {
        error: "A partition number conflict occurred — please try again.",
      };
    }
    throw err;
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}/design`);
  redirect(`/${orgSlug}/projects/${projectId}/design`);
}
