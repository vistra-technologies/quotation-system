"use client";

/**
 * Draft-state model for the Design page — Stage 21 (S21-0.4).
 *
 * Replaces the previous per-field immediate-write pattern
 * (design-workspace.tsx's mutatePartition) with a local draft + explicit Save.
 *
 * CONTRACT (append-only, frozen after Track 0 merges):
 *   - DraftAction is a discriminated union. Tracks A–D MAY add new variants at
 *     the bottom of the union and a matching `case` in draftReducer.
 *   - design-workspace.tsx is frozen: it only calls useDraftContext() for
 *     isDirty / save / discard / back-button guard. It never switches on action
 *     types. Do not edit design-workspace.tsx to add action handling.
 *   - To add a new action: (1) append its type to DraftAction, (2) add its
 *     `case` in draftReducer, (3) dispatch it from your UI component.
 *
 * Single-editor assumption: concurrent multi-user editing of the same partition
 * is not handled. Last Save wins. This is intentional for Stage 21.
 */

import React, { createContext, useContext, useReducer } from "react";
import { redirectToLogin } from "./login-redirect";
import { panelsToV2 } from "@/lib/partition-design";
import { makeDoorResolver, toPanelViewRow } from "./partition-view";
import type {
  DesignDoor,
  DesignPanel,
  EdgeSide,
  PartitionPatch,
  PartitionRow,
  RoomRow,
  SelectionRow,
} from "./types";

// ─── Selection type (replaces ConfigureSelection — always uses panelIds[]) ────

export type DraftSelection =
  | { type: "panel"; panelIds: string[] } // always an array; single-select uses length-1
  | { type: "edge"; side: EdgeSide }
  | null;

// ─── State ────────────────────────────────────────────────────────────────────

export interface DraftState {
  partitionId: string | null;
  draft: PartitionRow | null; // local working copy — mutated by reducer, not yet saved
  server: PartitionRow | null; // snapshot of last-saved state — restored on Discard
  isDirty: boolean; // true after any mutating action; false after LOAD_PARTITION or MARK_SAVED
  selection: DraftSelection;
  /**
   * Room renames deferred until Save. roomId → pending label.
   * Cleared by LOAD_PARTITION and MARK_SAVED. Set by SET_ROOM_NAME.
   * Track B's S21-B2 dispatches SET_ROOM_NAME from room-name-input.tsx.
   */
  pendingRoomNameEdits: Record<string, string>;
}

const initialDraftState: DraftState = {
  partitionId: null,
  draft: null,
  server: null,
  isDirty: false,
  selection: null,
  pendingRoomNameEdits: {},
};

// ─── Actions ──────────────────────────────────────────────────────────────────
//
// FROZEN after Track 0 merges. See contract note at the top of this file.

export type DraftAction =
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  // LOAD_PARTITION: replaces both draft and server snapshot, clears isDirty and
  // pendingRoomNameEdits. Call after a fresh GET /partitions/[id].
  | { type: "LOAD_PARTITION"; partition: PartitionRow }
  // MARK_SAVED: after a successful Save PATCH; updates server snapshot, clears
  // isDirty and pendingRoomNameEdits.
  | { type: "MARK_SAVED"; partition: PartitionRow }

  // ── Selection ──────────────────────────────────────────────────────────────
  // SET_SELECTION: replace selection entirely (pass null to deselect).
  | { type: "SET_SELECTION"; selection: DraftSelection }

  // ── Panel structural mutations ─────────────────────────────────────────────
  // ADD_PANEL: append a new glass panel, redividing the existing total width
  // evenly across all panels (including the new one) — the total is locked,
  // not grown (Stage 21 QA bug #16/#20).
  | { type: "ADD_PANEL" }
  // REMOVE_PANELS: caller ensures panelIds.length < total panels.
  | { type: "REMOVE_PANELS"; panelIds: string[] }
  // SPLIT_PANEL: caller ensures panel widthMm >= MIN_SPLIT_WIDTH_MM.
  | { type: "SPLIT_PANEL"; panelId: string }
  // MAKE_EQUAL_WIDTH: floor(subtotal/n) per targeted panel; last targeted panel
  // absorbs the remainder so the targeted subtotal is preserved exactly.
  // panelIds scopes the operation — panels not listed are left untouched
  // (Stage 21 QA bug #17: this used to silently equalize every panel in the
  // partition regardless of what was selected).
  | { type: "MAKE_EQUAL_WIDTH"; panelIds: string[] }
  // UNITE_PANELS: caller ensures panelIds are contiguous; merged width = sum of targets.
  | { type: "UNITE_PANELS"; panelIds: string[] }

  // ── Panel / partition dimension mutations ──────────────────────────────────
  // SET_PANEL_WIDTH: set exact widthMm on one or more panels (bulk-aware).
  | { type: "SET_PANEL_WIDTH"; panelIds: string[]; widthMm: number }
  // SET_PARTITION_WIDTH: proportional rescale all panels to a new total widthMm.
  | { type: "SET_PARTITION_WIDTH"; widthMm: number }
  // SET_PARTITION_HEIGHT: update heightMm; clamp each door.outerFrame.h ≤ heightMm.
  | { type: "SET_PARTITION_HEIGHT"; heightMm: number }
  // SET_PARTITION_LABEL: rename the partition.
  | { type: "SET_PARTITION_LABEL"; label: string }

  // ── Glass / door mutations (Track C/D UI dispatches these) ────────────────
  // SET_GLASS: set selectionId on targeted panels (null = clear glass assignment).
  | { type: "SET_GLASS"; panelIds: string[]; selectionId: string | null }
  // TOGGLE_DOOR: if panel has a door, remove it; else add with selectionId.
  | { type: "TOGGLE_DOOR"; panelId: string; selectionId: string }
  // SET_DOOR_HEIGHT: update door.outerFrame.h; clamped to partition.heightMm.
  | { type: "SET_DOOR_HEIGHT"; panelId: string; heightMm: number }
  // SET_DOOR_HINGE: switch hinging on an existing door.
  | { type: "SET_DOOR_HINGE"; panelId: string; hinging: "left" | "right" }

  // ── Room name (Track B's S21-B2 dispatches this) ──────────────────────────
  // SET_ROOM_NAME: deferred room rename; only written to the server on Save via
  // PATCH /api/v1/orgs/[orgSlug]/rooms/[id]. Marks isDirty true.
  | { type: "SET_ROOM_NAME"; roomId: string; name: string }

  // ── Edge stops (migrates saved-components-rail assignProfile call site) ────
  // SET_STOPS: update one edge-profile stop in design.stops. Track D removes the
  // UI that dispatches this (D-5), but the call site must compile cleanly.
  | { type: "SET_STOPS"; side: EdgeSide; selectionId: string | null }

  // ── Bulk independent panel width map (Track D — sum-preserving Apply Width) ─
  // SET_PANEL_WIDTHS_MAP: set each listed panel's widthMm independently in one
  // dispatch. Used by panel-context-menu's Apply Width and Standard Width buttons,
  // which redistribute the remaining width across non-target panels before
  // dispatching so the sum is preserved exactly (last-panel-absorbs-remainder
  // pattern, matching SET_PARTITION_WIDTH). Unlisted panels are left unchanged.
  | { type: "SET_PANEL_WIDTHS_MAP"; widths: Record<string, number> };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function mutatePanels(
  state: DraftState,
  fn: (panels: DesignPanel[]) => DesignPanel[],
): DraftState {
  if (!state.draft) return state;
  const panels = state.draft.design?.panels ?? [];
  return {
    ...state,
    draft: {
      ...state.draft,
      design: { ...state.draft.design, panels: fn(panels) },
    },
    isDirty: true,
  };
}

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    // ── Lifecycle ────────────────────────────────────────────────────────────
    case "LOAD_PARTITION":
      return {
        ...state,
        partitionId: action.partition.id,
        draft: action.partition,
        server: action.partition,
        isDirty: false,
        selection: null,
        pendingRoomNameEdits: {},
      };

    case "MARK_SAVED":
      return {
        ...state,
        server: action.partition,
        draft: action.partition,
        isDirty: false,
        pendingRoomNameEdits: {},
      };

    // ── Selection ────────────────────────────────────────────────────────────
    case "SET_SELECTION":
      return { ...state, selection: action.selection };

    // ── Panel structural mutations ────────────────────────────────────────────
    case "ADD_PANEL": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      // Stage 21 QA bug #16/#20: the total partition width is locked — adding a
      // panel must redivide the EXISTING total across the new panel count, not
      // append a flat DEFAULT_PANEL_WIDTH_MM on top of it (which grew the total
      // and misassigned the remaining space). Same last-absorbs-remainder
      // pattern as SET_PARTITION_WIDTH so the sum is preserved exactly.
      const existingTotal = panels.reduce((s, p) => s + p.widthMm, 0);
      const newCount = panels.length + 1;
      const base = Math.max(1, Math.floor(existingTotal / newCount));
      const newPanel: DesignPanel = {
        id: crypto.randomUUID(),
        type: "glass",
        widthMm: base,
        heightMm: state.draft.heightMm,
        selectionId:
          panels.length > 0 && panels.every((p) => p.selectionId === panels[0].selectionId)
            ? panels[0].selectionId
            : null,
      };
      return mutatePanels(state, (ps) => {
        const resized = ps.map((p) => ({ ...p, widthMm: base }));
        // The new panel gets whatever's left after the other (newCount - 1)
        // panels take `base` each — NOT base + that remainder, which would
        // double-count its own share and grow the total (the bug this was
        // meant to fix in the first place).
        const remainder = existingTotal - base * ps.length;
        return [...resized, { ...newPanel, widthMm: Math.max(1, remainder) }];
      });
    }

    case "REMOVE_PANELS": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const survivors = panels.filter((p) => !action.panelIds.includes(p.id));
      if (survivors.length === 0) {
        return mutatePanels({ ...state, selection: null }, () => survivors);
      }
      // Stage 21 QA bug #16: removing panels must redistribute the partition's
      // existing total across the surviving panels, not just drop the removed
      // panels' width and shrink the total.
      const total = panels.reduce((s, p) => s + p.widthMm, 0);
      const base = Math.max(1, Math.floor(total / survivors.length));
      return mutatePanels({ ...state, selection: null }, () =>
        survivors.map((p, i) => ({
          ...p,
          widthMm:
            i === survivors.length - 1
              ? Math.max(1, total - base * (survivors.length - 1))
              : base,
        })),
      );
    }

    case "SPLIT_PANEL": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const idx = panels.findIndex((p) => p.id === action.panelId);
      if (idx === -1) return state;
      const orig = panels[idx];
      const half = Math.floor(orig.widthMm / 2);
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      // Reset type to "glass" on both halves — orig may have type:"door" if it was
      // a door panel; halves have door:null so they must also be type:"glass".
      const a: DesignPanel = { ...orig, id: firstId, widthMm: half, type: "glass", door: null };
      const b: DesignPanel = { ...orig, id: secondId, widthMm: orig.widthMm - half, type: "glass", door: null };
      return {
        ...mutatePanels(state, (ps) => [...ps.slice(0, idx), a, b, ...ps.slice(idx + 1)]),
        selection: { type: "panel", panelIds: [firstId] },
      };
    }

    case "MAKE_EQUAL_WIDTH": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      // Only equalize the targeted panels — fall back to all panels when
      // nothing specific was targeted (e.g. a single-panel right-click with no
      // multi-selection). Panels outside panelIds are left untouched.
      const targets = action.panelIds.length > 0
        ? panels.filter((p) => action.panelIds.includes(p.id))
        : panels;
      if (targets.length < 2) return state;
      const subtotal = targets.reduce((s, p) => s + p.widthMm, 0);
      const base = Math.floor(subtotal / targets.length);
      const targetIdSet = new Set(targets.map((p) => p.id));
      let seen = 0;
      return mutatePanels(state, (ps) =>
        ps.map((p) => {
          if (!targetIdSet.has(p.id)) return p;
          seen += 1;
          const isLastTarget = seen === targets.length;
          return {
            ...p,
            widthMm: isLastTarget ? subtotal - base * (targets.length - 1) : base,
          };
        }),
      );
    }

    case "UNITE_PANELS": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const targets = panels.filter((p) => action.panelIds.includes(p.id));
      if (targets.length < 2) return state;
      const totalWidth = targets.reduce((s, p) => s + p.widthMm, 0);
      const firstTarget = targets[0];
      const mergedId = crypto.randomUUID();
      const merged: DesignPanel = {
        ...firstTarget,
        id: mergedId,
        widthMm: totalWidth,
        door: null,
      };
      const newState = mutatePanels(state, (ps) =>
        ps
          .map((p) => (p.id === firstTarget.id ? merged : p))
          .filter((p) => p.id === mergedId || !action.panelIds.includes(p.id)),
      );
      return { ...newState, selection: { type: "panel", panelIds: [mergedId] } };
    }

    // ── Panel / partition dimension mutations ─────────────────────────────────
    case "SET_PANEL_WIDTH":
      return mutatePanels(state, (ps) =>
        ps.map((p) =>
          action.panelIds.includes(p.id) ? { ...p, widthMm: action.widthMm } : p,
        ),
      );

    case "SET_PARTITION_WIDTH": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const oldTotal = panels.reduce((s, p) => s + p.widthMm, 0);
      if (oldTotal === 0) return state;
      const scale = action.widthMm / oldTotal;
      // Scale each panel, then adjust the last panel by the remainder so the
      // sum equals action.widthMm exactly. Independent per-panel Math.round()
      // can produce a sum that differs by ±(N−1) mm, which would be persisted
      // to the DB as the wrong dimension.
      const scaled = panels.map((p) => Math.max(1, Math.round(p.widthMm * scale)));
      const scaledSum = scaled.reduce((s, w) => s + w, 0);
      const remainder = action.widthMm - scaledSum;
      return mutatePanels(state, (ps) =>
        ps.map((p, i) => ({
          ...p,
          widthMm: i === ps.length - 1
            ? Math.max(1, scaled[i] + remainder)
            : scaled[i],
        })),
      );
    }

    case "SET_PARTITION_HEIGHT": {
      if (!state.draft) return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          heightMm: action.heightMm,
          design: {
            ...state.draft.design,
            panels: (state.draft.design?.panels ?? []).map((p) => {
              if (!p.door) return { ...p, heightMm: action.heightMm };
              const clampedH = Math.min(
                p.door.outerFrame?.h ?? action.heightMm,
                action.heightMm,
              );
              return {
                ...p,
                heightMm: action.heightMm,
                door: {
                  ...p.door,
                  outerFrame: { w: p.door.outerFrame?.w ?? p.widthMm, h: clampedH },
                },
              };
            }),
          },
        },
        isDirty: true,
      };
    }

    case "SET_PARTITION_LABEL":
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, label: action.label }, isDirty: true };

    // ── Glass / door mutations ────────────────────────────────────────────────
    case "SET_GLASS":
      return mutatePanels(state, (ps) =>
        ps.map((p) =>
          action.panelIds.includes(p.id) ? { ...p, selectionId: action.selectionId } : p,
        ),
      );

    case "TOGGLE_DOOR":
      return mutatePanels(state, (ps) =>
        ps.map((p): DesignPanel => {
          if (p.id !== action.panelId) return p;
          if (p.door) return { ...p, type: "glass", door: null };
          const wallHeightMm = state.draft?.heightMm ?? p.heightMm;
          const door: DesignDoor = {
            selectionId: action.selectionId,
            hinging: "left",
            outerFrame: { w: p.widthMm, h: wallHeightMm },
          };
          return { ...p, type: "door", door };
        }),
      );

    case "SET_DOOR_HEIGHT":
      return mutatePanels(state, (ps) =>
        ps.map((p) => {
          if (p.id !== action.panelId || !p.door) return p;
          const clampedH = Math.min(action.heightMm, state.draft?.heightMm ?? action.heightMm);
          return {
            ...p,
            door: {
              ...p.door,
              outerFrame: { w: p.door.outerFrame?.w ?? p.widthMm, h: clampedH },
            },
          };
        }),
      );

    case "SET_DOOR_HINGE":
      return mutatePanels(state, (ps) =>
        ps.map((p) => {
          if (p.id !== action.panelId || !p.door) return p;
          return { ...p, door: { ...p.door, hinging: action.hinging } };
        }),
      );

    // ── Room name ─────────────────────────────────────────────────────────────
    case "SET_ROOM_NAME":
      return {
        ...state,
        pendingRoomNameEdits: { ...state.pendingRoomNameEdits, [action.roomId]: action.name },
        isDirty: true,
      };

    // ── Bulk panel width map ──────────────────────────────────────────────────
    case "SET_PANEL_WIDTHS_MAP":
      return mutatePanels(state, (ps) =>
        ps.map((p) =>
          action.widths[p.id] !== undefined ? { ...p, widthMm: action.widths[p.id]! } : p,
        ),
      );

    // ── Edge stops ────────────────────────────────────────────────────────────
    case "SET_STOPS": {
      if (!state.draft) return state;
      const stops = { ...(state.draft.design?.stops ?? {}), [action.side]: action.selectionId };
      return {
        ...state,
        draft: { ...state.draft, design: { ...state.draft.design, stops } },
        isDirty: true,
      };
    }

    default:
      return state;
  }
}

// ─── Save / discard results ───────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; partition: PartitionRow; updatedRooms: RoomRow[] }
  | { ok: false; error: string };

// ─── Context ──────────────────────────────────────────────────────────────────

interface DraftContextValue {
  state: DraftState;
  dispatch: React.Dispatch<DraftAction>;
  /**
   * One PATCH of the partition design + PATCHes for all pendingRoomNameEdits
   * (parallel). On success dispatches MARK_SAVED and returns updatedRooms so
   * design-workspace.tsx can update its floors state.
   */
  save: (orgSlug: string, isSubdomain: boolean) => Promise<SaveResult>;
  /**
   * Reload the partition fresh from the server → dispatches LOAD_PARTITION,
   * which also clears pendingRoomNameEdits (room renames are discarded).
   */
  discard: (orgSlug: string, isSubdomain: boolean) => Promise<void>;
}

const DraftContext = createContext<DraftContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DraftProvider({
  children,
  selections,
}: {
  children: React.ReactNode;
  /** The project's Selections — used to tell a door cell from a glass cell when a stored v2
   * document is converted to the panel view (Stage 22, D-5). */
  selections: SelectionRow[];
}) {
  const [state, dispatch] = useReducer(draftReducer, initialDraftState);

  async function save(orgSlug: string, isSubdomain: boolean): Promise<SaveResult> {
    if (!state.partitionId || !state.draft) {
      return { ok: false, error: "No active partition." };
    }

    // Stage 21 QA bug #13: a partition must never persist with a glass panel
    // that has no glass type assigned — checked client-side before the PATCH
    // so the user gets an immediate, specific error instead of a silently
    // incomplete save.
    const unassignedGlassPanels = (state.draft.design?.panels ?? []).filter(
      (p) => p.type === "glass" && !p.selectionId,
    );
    if (unassignedGlassPanels.length > 0) {
      return {
        ok: false,
        error: `${unassignedGlassPanels.length} panel(s) still need a glass type assigned before saving.`,
      };
    }

    const patchBody: PartitionPatch = {
      label: state.draft.label,
      heightMm: state.draft.heightMm,
      // Stage 22: the reducer keeps its panel view; the Save path is the serializer to v2.
      design: state.draft.design
        ? panelsToV2(state.draft.design, state.draft.heightMm)
        : undefined,
    };

    const pendingRooms = Object.entries(state.pendingRoomNameEdits);

    try {
      const [partitionRes, ...roomResults] = await Promise.all([
        fetch(`/api/v1/orgs/${orgSlug}/partitions/${state.partitionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        }),
        ...pendingRooms.map(([roomId, label]) =>
          fetch(`/api/v1/orgs/${orgSlug}/rooms/${roomId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          }),
        ),
      ]);

      if (partitionRes.status === 401 || partitionRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return { ok: false, error: "Redirecting to login." };
      }
      if (!partitionRes.ok) {
        const body = (await partitionRes.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? "An unexpected error occurred — please try again." };
      }
      const { partition: savedRaw } = (await partitionRes.json()) as { partition: PartitionRow };
      let updated: PartitionRow;
      try {
        updated = toPanelViewRow(savedRaw, makeDoorResolver(selections));
      } catch {
        return { ok: false, error: "Saved, but the stored design could not be re-read — please reload the page." };
      }

      const updatedRooms: RoomRow[] = [];
      for (let i = 0; i < roomResults.length; i++) {
        const res = roomResults[i];
        if (res.status === 401 || res.status === 403) {
          redirectToLogin(orgSlug, isSubdomain);
          return { ok: false, error: "Redirecting to login." };
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? "Failed to rename room — please try again." };
        }
        const { room } = (await res.json()) as { room: RoomRow };
        updatedRooms.push(room);
      }

      dispatch({ type: "MARK_SAVED", partition: updated });
      return { ok: true, partition: updated, updatedRooms };
    } catch {
      return { ok: false, error: "Network error — please try again." };
    }
  }

  async function discard(orgSlug: string, isSubdomain: boolean): Promise<void> {
    if (!state.partitionId) return;
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/partitions/${state.partitionId}`);
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) return;
      const { partition: raw } = (await res.json()) as { partition: PartitionRow };
      dispatch({
        type: "LOAD_PARTITION",
        partition: toPanelViewRow(raw, makeDoorResolver(selections)),
      });
    } catch {
      // Silently fail (incl. an unparseable stored design) — state remains dirty, user can retry.
    }
  }

  return (
    <DraftContext.Provider value={{ state, dispatch, save, discard }}>
      {children}
    </DraftContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDraftContext(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraftContext must be used inside <DraftProvider>");
  return ctx;
}

// ─── Shared room-name selector (R-8c) ────────────────────────────────────────
//
// Returns the effective display name for a room: any pending (unsaved) rename
// takes precedence over the server-saved room.label. Every component that shows
// a room name for display purposes should use this instead of reading room.label
// directly — otherwise a rename entered in the canvas header won't propagate
// until the user hits Save.
//
// Design decision (2026-09-18): the rename stays draft-only (SET_ROOM_NAME →
// pendingRoomNameEdits). This is a *read* helper only — no write-path changes.
export function useEffectiveRoomName(room: { id: string; label: string }): string {
  const { state } = useDraftContext();
  return state.pendingRoomNameEdits[room.id] ?? room.label;
}
