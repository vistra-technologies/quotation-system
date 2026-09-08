"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// Shared types (duplicated from lib/data/rooms.ts to avoid bundling
// server-only DAL code into these thin marshalers — same convention as
// configuration/page.tsx's FieldEntry/ComponentTypeRow duplication).
// ---------------------------------------------------------------------------

type ApiRoomSide =
  | {
      id: string;
      kind: "PLAIN";
      partitionId: null;
      turnDegrees: number;
      lengthMm: number | null;
      label: string | null;
    }
  | {
      id: string;
      kind: "PARTITION";
      partitionId: string;
      turnDegrees: number;
      lengthMm: null;
      label: null;
    };

interface ApiRoom {
  id: string;
  floorId: string;
  label: string;
  sides: ApiRoomSide[];
}

// ---------------------------------------------------------------------------
// createRoomAction
// ---------------------------------------------------------------------------

export type CreateRoomState = { error: string | null };

/**
 * Create a new Room under a floor (Stage 18 scope item 4-2: "New Room" entry
 * point). The API's createRoom() already writes the default 4-side PLAIN
 * rectangle (lib/data/rooms.ts) — this action is just the UI trigger.
 *
 * On success, redirects back to the design page with ?openRoom=<id> so the
 * left rail auto-expands the newly created room.
 */
export async function createRoomAction(
  prevState: CreateRoomState,
  formData: FormData,
): Promise<CreateRoomState> {
  const orgSlug = (formData.get("orgSlug") as string | null)?.trim() ?? "";
  const projectId = (formData.get("projectId") as string | null)?.trim() ?? "";
  const floorId = (formData.get("floorId") as string | null)?.trim() ?? "";
  const label = (formData.get("label") as string | null)?.trim();

  if (!label) return { error: "Room name is required." };
  if (!floorId) return { error: "Floor is required." };

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/rooms`, {
    method: "POST",
    body: JSON.stringify({ floorId, label }),
  });

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage };
  }

  const { room } = (await res.json()) as { room: ApiRoom };

  revalidatePath(`/${orgSlug}/projects/${projectId}/design`);
  redirect(
    await orgHref(
      orgSlug,
      `/projects/${projectId}/design?openRoom=${room.id}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// convertSideAction
// ---------------------------------------------------------------------------

export type ConvertSideState = { error: string | null };

/**
 * Convert one PLAIN side of a room to PARTITION (Stage 18 scope item 4-3).
 *
 * Fetches the room's CURRENT sides fresh (GET /rooms?floorId=) rather than
 * trusting anything the client posted back — matches replaceSides()'s own
 * "never trust the client for array state" posture (lib/data/rooms.ts) and
 * sidesteps the PLAIN-side-id-is-positional caveat from
 * review-item2-round2.md finding 9: the target side is identified by its
 * ARRAY INDEX at the moment of conversion (sideIndex, captured when the form
 * was rendered from the same fresh read the page just did), not by side.id.
 *
 * Rebuilds the full sides array (full-replace PATCH contract — see
 * app/api/v1/orgs/[orgSlug]/rooms/[id]/sides/route.ts), leaving every other
 * side unchanged and only replacing the target index with a new PARTITION
 * element (no partitionId — signals a new convert to replaceSides()).
 *
 * Unit normalisation mirrors the pre-Stage-18 createWall() action:
 *   mm -> Math.round(value); feet -> Math.round(value * 304.8).
 */
export async function convertSideAction(
  prevState: ConvertSideState,
  formData: FormData,
): Promise<ConvertSideState> {
  const orgSlug = (formData.get("orgSlug") as string | null)?.trim() ?? "";
  const projectId = (formData.get("projectId") as string | null)?.trim() ?? "";
  const floorId = (formData.get("floorId") as string | null)?.trim() ?? "";
  const roomId = (formData.get("roomId") as string | null)?.trim() ?? "";
  const sideIndexRaw = formData.get("sideIndex") as string | null;
  const label = (formData.get("label") as string | null)?.trim();
  const heightRaw = formData.get("height") as string | null;
  const widthRaw = formData.get("width") as string | null;
  const unitH = (formData.get("unit_h") as string | null) ?? "mm";
  const unitW = (formData.get("unit_w") as string | null) ?? "mm";

  const sideIndex = sideIndexRaw !== null ? parseInt(sideIndexRaw, 10) : NaN;

  if (!label) return { error: "Label is required." };
  if (!floorId || !roomId || isNaN(sideIndex)) {
    return { error: "Missing room context — please reload and try again." };
  }
  if (!heightRaw || isNaN(Number(heightRaw)) || Number(heightRaw) <= 0) {
    return { error: "Height must be a positive number." };
  }
  if (!widthRaw || isNaN(Number(widthRaw)) || Number(widthRaw) <= 0) {
    return { error: "Width must be a positive number." };
  }

  const heightMm =
    unitH === "feet"
      ? Math.round(Number(heightRaw) * 304.8)
      : Math.round(Number(heightRaw));
  const widthMm =
    unitW === "feet"
      ? Math.round(Number(widthRaw) * 304.8)
      : Math.round(Number(widthRaw));

  // Re-fetch the room's current sides fresh (see doc comment above).
  const roomsRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/rooms?floorId=${floorId}`,
  );

  if (roomsRes.status === 401 || roomsRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!roomsRes.ok) {
    return { error: "Could not load the room — please try again." };
  }

  const { rooms } = (await roomsRes.json()) as { rooms: ApiRoom[] };
  const room = rooms.find((r) => r.id === roomId);
  if (!room) {
    return { error: "Room not found — please reload and try again." };
  }
  if (sideIndex < 0 || sideIndex >= room.sides.length) {
    return { error: "Side no longer exists — please reload and try again." };
  }
  const targetSide = room.sides[sideIndex];
  if (targetSide.kind !== "PLAIN") {
    return { error: "This side has already been converted — please reload." };
  }

  const newSides = room.sides.map((side, i) => {
    if (i === sideIndex) {
      return {
        kind: "PARTITION" as const,
        turnDegrees: side.turnDegrees,
        label,
        heightMm,
        widthMm,
      };
    }
    if (side.kind === "PARTITION") {
      return {
        kind: "PARTITION" as const,
        turnDegrees: side.turnDegrees,
        partitionId: side.partitionId,
      };
    }
    return {
      kind: "PLAIN" as const,
      turnDegrees: side.turnDegrees,
      lengthMm: side.lengthMm,
      label: side.label,
    };
  });

  const patchRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/rooms/${roomId}/sides`,
    {
      method: "PATCH",
      body: JSON.stringify({ sides: newSides }),
    },
  );

  if (patchRes.status === 401 || patchRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!patchRes.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await patchRes.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage };
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}/design`);
  redirect(
    await orgHref(orgSlug, `/projects/${projectId}/design?openRoom=${roomId}`),
  );
}
