"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// resolveFloorAndRoom
// ---------------------------------------------------------------------------

export type ResolveFloorAndRoomState = { error: string | null };

interface FloorRow {
  id: string;
  label: string;
}

interface RoomRow {
  id: string;
  label: string;
}

/**
 * Resolve-or-create a Floor, then resolve-or-create a Room under it
 * (Stage 18 scope item 4: "the flow gains a room step" — supersedes the
 * pre-Stage-18 free-text "floor label, auto-create" + createPartition()
 * flow).
 *
 * Design decision (see plan-item3.md / worklog): this action does NOT create
 * a Partition itself. It only resolves floor+room, then redirects into the
 * design page with ?openRoom=<id> so the user picks which PLAIN side to
 * convert via the design page's own "Convert to Partition" form
 * (design/convert-side-form.tsx + design/actions.ts's convertSideAction) —
 * reusing that logic rather than duplicating a second height/width/label
 * form and a second "which sides array am I patching" implementation here.
 *
 * Both floor and room are "select existing (exact label match) or create"
 * by free text, matching the pre-Stage-18 floor UX; room follows the same
 * pattern, scoped to the resolved floor.
 */
export async function resolveFloorAndRoom(
  prevState: ResolveFloorAndRoomState,
  formData: FormData,
): Promise<ResolveFloorAndRoomState> {
  const orgSlug = (formData.get("orgSlug") as string | null)?.trim() ?? "";
  const projectId = (formData.get("projectId") as string | null)?.trim() ?? "";
  const floorLabel = (formData.get("floorLabel") as string | null)?.trim();
  const roomLabel = (formData.get("roomLabel") as string | null)?.trim();

  if (!floorLabel) return { error: "Floor is required." };
  if (!roomLabel) return { error: "Room is required." };

  // ── Resolve or create the Floor ─────────────────────────────────────────
  const floorsRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`,
  );
  if (floorsRes.status === 401 || floorsRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!floorsRes.ok) {
    return { error: "Could not load floors — please try again." };
  }
  const { floors } = (await floorsRes.json()) as { floors: FloorRow[] };
  let floor = floors.find((f) => f.label === floorLabel);

  if (!floor) {
    const createFloorRes = await internalFetch(
      `/api/v1/orgs/${orgSlug}/floors`,
      {
        method: "POST",
        body: JSON.stringify({ projectId, label: floorLabel }),
      },
    );
    if (createFloorRes.status === 401 || createFloorRes.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (!createFloorRes.ok) {
      let errorMessage = "Failed to resolve floor — please try again.";
      try {
        const body = (await createFloorRes.json()) as { error?: string };
        if (body.error) errorMessage = body.error;
      } catch {
        // ignore JSON parse failure
      }
      return { error: errorMessage };
    }
    floor = ((await createFloorRes.json()) as { floor: FloorRow }).floor;
  }

  // ── Resolve or create the Room under that Floor ─────────────────────────
  const roomsRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/rooms?floorId=${floor.id}`,
  );
  if (roomsRes.status === 401 || roomsRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!roomsRes.ok) {
    return { error: "Could not load rooms — please try again." };
  }
  const { rooms } = (await roomsRes.json()) as { rooms: RoomRow[] };
  let room = rooms.find((r) => r.label === roomLabel);

  if (!room) {
    const createRoomRes = await internalFetch(`/api/v1/orgs/${orgSlug}/rooms`, {
      method: "POST",
      body: JSON.stringify({ floorId: floor.id, label: roomLabel }),
    });
    if (createRoomRes.status === 401 || createRoomRes.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (!createRoomRes.ok) {
      let errorMessage = "Failed to resolve room — please try again.";
      try {
        const body = (await createRoomRes.json()) as { error?: string };
        if (body.error) errorMessage = body.error;
      } catch {
        // ignore JSON parse failure
      }
      return { error: errorMessage };
    }
    room = ((await createRoomRes.json()) as { room: RoomRow }).room;
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}/design`);
  redirect(
    await orgHref(
      orgSlug,
      `/projects/${projectId}/design?openRoom=${room.id}`,
    ),
  );
}
