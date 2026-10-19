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
import { fillDefaultGlassPanels, panelsToV2, pickTransomGlass } from "@/lib/partition-design";
import { freezeCheck, type FreezeAction } from "@/lib/panel-freeze";
import {
  planAddPanel,
  planEqualize,
  planRemove,
  planSetWidths,
  planWallWidth,
  type WidthPlan,
  type WidthRefusal,
} from "@/lib/panel-widths";
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
import { apiErrorMessage } from "@/lib/api-error-message";

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
  /**
   * Stage 34 (D-12): the last refused edit, shown as a one-line notice over the canvas card's bottom
   * padding. Set when a width/lock rule refuses an action (the draft is left unchanged); cleared by the
   * next successful edit, a selection change, a load/save, or CLEAR_NOTICE.
   */
  notice: DraftNotice | null;
}

/** Stage 34 Batch 4: the lock notices. PANEL_LOCKED = "Panel is locked", LOCKED_SKIPPED = "N locked panels
 *  skipped", GLASS_KEPT = "N locked panels kept their glass". */
export type LockNoticeCode = "PANEL_LOCKED" | "LOCKED_SKIPPED" | "GLASS_KEPT";

export interface DraftNotice {
  code: WidthRefusal | LockNoticeCode;
  /** Lock notices: the locked panels the message is about (the "Unlock" link unlocks these). */
  ids?: string[];
  /** LOCKED_SKIPPED / GLASS_KEPT: how many locked panels were skipped / kept their glass. */
  skipped?: number;
  /** LOCKED_SKIPPED: how many panels the action was aimed at. */
  total?: number;
}

export function isLockNotice(n: DraftNotice | null): n is DraftNotice & { code: LockNoticeCode } {
  return !!n && (n.code === "PANEL_LOCKED" || n.code === "LOCKED_SKIPPED" || n.code === "GLASS_KEPT");
}

const initialDraftState: DraftState = {
  partitionId: null,
  draft: null,
  server: null,
  isDirty: false,
  selection: null,
  pendingRoomNameEdits: {},
  notice: null,
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
  | { type: "SET_PANEL_WIDTHS_MAP"; widths: Record<string, number> }

  // ── Stage 34: lock flag, default-glass fill, refusal notice ─────────────────
  // SET_PANEL_LOCKED: lock / unlock the listed panels.
  | { type: "SET_PANEL_LOCKED"; panelIds: string[]; locked: boolean }
  // UNLOCK_ALL: clear every lock on the wall.
  | { type: "UNLOCK_ALL" }
  // FILL_DEFAULT_GLASS: give every unassigned glass cell the project's default glass. Ignores locks
  // (filling a null cell is not a "change"); a no-op when nothing is unassigned.
  | { type: "FILL_DEFAULT_GLASS"; glassId: string | null }
  // SET_NOTICE / CLEAR_NOTICE: show / clear a refusal notice (e.g. the wall-width field's own refusals).
  | { type: "SET_NOTICE"; code: WidthRefusal }
  | { type: "CLEAR_NOTICE" }
  // NOTIFY_LOCKED (Batch 4): show "Panel is locked · Unlock" for an attempt that never reaches a mutating
  // action (a divider next to a locked panel, the read-only rail width field).
  | { type: "NOTIFY_LOCKED"; panelIds: string[] };

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
    notice: null,
  };
}

/** A refused edit: the draft stays exactly as it was; only the notice changes. */
function refuse(state: DraftState, code: WidthRefusal): DraftState {
  return { ...state, notice: { code } };
}

/** Apply a successful width plan: new widths, plus the locks the edit implies. */
function applyPlan(state: DraftState, plan: Extract<WidthPlan, { ok: true }>): DraftState {
  return mutatePanels(state, (ps) =>
    ps.map((p) => {
      const w = plan.widths[p.id];
      const lock = plan.lockIds.includes(p.id);
      if (w === undefined && !lock) return p;
      return { ...p, widthMm: w ?? p.widthMm, ...(lock ? { locked: true } : {}) };
    }),
  );
}

/** A copy of the panel with no lock (split halves and united panels start unlocked, D-4). */
function unlocked(p: DesignPanel): DesignPanel {
  const copy = { ...p };
  delete copy.locked;
  return copy;
}

/**
 * The ONE freeze guard (Stage 34 S34-3 / Batch 4): lib/panel-freeze.ts decides, for every action, whether
 * a locked panel blocks it, narrows it to the unlocked panels, or lets it through. Buttons and menus only
 * grey themselves for UX; nothing else tests `locked` in front of a mutating action.
 */
function draftReducer(
  state: DraftState,
  action: DraftAction,
  defaultGlassId: string | null,
): DraftState {
  const verdict = freezeCheck(state.draft?.design?.panels ?? [], action as unknown as FreezeAction);
  if (verdict.kind === "block") {
    return { ...state, notice: { code: "PANEL_LOCKED", ids: verdict.lockedIds } };
  }
  if (verdict.kind === "narrow") {
    const narrowed = { ...action, panelIds: verdict.panelIds } as DraftAction;
    const next = verdict.panelIds.length > 0 ? reduceAction(state, narrowed, defaultGlassId) : state;
    if (verdict.note === "GLASS_KEPT") {
      // Applied to unlocked panels; the note is set last because a mutation clears the notice.
      return {
        ...next,
        notice:
          verdict.keptCount > 0 ? { code: "GLASS_KEPT", ids: verdict.skipped, skipped: verdict.keptCount } : null,
      };
    }
    // A planner refusal (e.g. no absorber) already set its own notice: keep that.
    if (next.notice) return next;
    return {
      ...next,
      notice: { code: "LOCKED_SKIPPED", ids: verdict.skipped, skipped: verdict.skipped.length, total: verdict.total },
    };
  }
  return reduceAction(state, action, defaultGlassId);
}

function reduceAction(
  state: DraftState,
  action: DraftAction,
  defaultGlassId: string | null,
): DraftState {
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
        notice: null,
      };

    case "MARK_SAVED":
      return {
        ...state,
        server: action.partition,
        draft: action.partition,
        isDirty: false,
        pendingRoomNameEdits: {},
        notice: null,
      };

    // ── Selection ────────────────────────────────────────────────────────────
    case "SET_SELECTION":
      return { ...state, selection: action.selection, notice: null };

    // ── Panel structural mutations ────────────────────────────────────────────
    case "ADD_PANEL": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      if (panels.length === 0) return state;
      // Stage 34 (S34-3): only UNLOCKED panels re-divide to make room (lib/panel-widths.ts); refused
      // when none can absorb. The new panel inherits the wall's glass when it is uniform, else the
      // project's default glass (S34-7 client mirror, D-13).
      const plan = planAddPanel(panels);
      if (!plan.ok) return refuse(state, plan.reason);
      const uniform = panels.every((p) => p.selectionId === panels[0].selectionId)
        ? panels[0].selectionId
        : null;
      const newPanel: DesignPanel = {
        id: crypto.randomUUID(),
        type: "glass",
        widthMm: plan.newWidthMm,
        heightMm: state.draft.heightMm,
        selectionId: uniform ?? defaultGlassId,
      };
      return mutatePanels(state, (ps) => [
        ...ps.map((p) => (plan.widths[p.id] !== undefined ? { ...p, widthMm: plan.widths[p.id] } : p)),
        newPanel,
      ]);
    }

    case "REMOVE_PANELS": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const survivors = panels.filter((p) => !action.panelIds.includes(p.id));
      if (survivors.length === 0) {
        return mutatePanels({ ...state, selection: null }, () => survivors);
      }
      // The freed width goes to the unlocked survivors only (lib/panel-widths.ts).
      const plan = planRemove(panels, action.panelIds);
      if (!plan.ok) return refuse(state, plan.reason);
      return mutatePanels({ ...state, selection: null }, () =>
        survivors.map((p) => (plan.widths[p.id] !== undefined ? { ...p, widthMm: plan.widths[p.id] } : p)),
      );
    }

    case "SPLIT_PANEL": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const idx = panels.findIndex((p) => p.id === action.panelId);
      if (idx === -1) return state;
      const orig = unlocked(panels[idx]);
      const half = Math.floor(orig.widthMm / 2);
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      // Reset type to "glass" on both halves — orig may have type:"door" if it was
      // a door panel; halves have door:null so they must also be type:"glass".
      // A half with no glass to inherit gets the project's default glass (S34-7 client mirror).
      const glass = orig.selectionId ?? defaultGlassId;
      const a: DesignPanel = { ...orig, id: firstId, widthMm: half, type: "glass", door: null, selectionId: glass };
      const b: DesignPanel = { ...orig, id: secondId, widthMm: orig.widthMm - half, type: "glass", door: null, selectionId: glass };
      return {
        ...mutatePanels(state, (ps) => [...ps.slice(0, idx), a, b, ...ps.slice(idx + 1)]),
        selection: { type: "panel", panelIds: [firstId] },
      };
    }

    case "MAKE_EQUAL_WIDTH": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      // panelIds scopes the operation; empty = the whole wall. Only UNLOCKED panels are evened out
      // and locks are kept; refused when fewer than two unlocked panels are in scope.
      const plan = planEqualize(panels, action.panelIds.length > 0 ? action.panelIds : null);
      if (!plan.ok) return refuse(state, plan.reason);
      return applyPlan(state, plan);
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
        ...unlocked(firstTarget),
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
    case "SET_PANEL_WIDTH": {
      if (!state.draft) return state;
      // Typed / standard width: targets get the width and lock; unlocked others absorb (D-10 minimums).
      const plan = planSetWidths(state.draft.design?.panels ?? [], action.panelIds, action.widthMm);
      if (!plan.ok) return refuse(state, plan.reason);
      return applyPlan(state, plan);
    }

    case "SET_PARTITION_WIDTH": {
      if (!state.draft) return state;
      // Wall total: only unlocked panels resize (proportionally, last takes the remainder).
      const plan = planWallWidth(state.draft.design?.panels ?? [], action.widthMm);
      if (!plan.ok) return refuse(state, plan.reason);
      return applyPlan(state, plan);
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
          const wallH = state.draft?.heightMm ?? action.heightMm;
          const clampedH = Math.min(action.heightMm, wallH);
          // H-7: a shorter door opens a glass strip above it; give it glass if the panel has none.
          const glass =
            clampedH < wallH && !p.selectionId
              ? pickTransomGlass(
                  ps,
                  p.id,
                  state.draft?.design?.defaults?.glassSelectionId ?? defaultGlassId,
                )
              : p.selectionId;
          return {
            ...p,
            selectionId: glass,
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
    case "SET_PANEL_WIDTHS_MAP": {
      // Divider drag / nudge only. A divider next to a locked panel cannot move (the canvas blocks it; this
      // is the backstop), and a move LOCKS both neighbours it sets (Stage 34 S34-3).
      const panels = state.draft?.design?.panels ?? [];
      const lockedHit = panels.filter((p) => p.locked && action.widths[p.id] !== undefined).map((p) => p.id);
      if (lockedHit.length > 0) return { ...state, notice: { code: "PANEL_LOCKED", ids: lockedHit } };
      return mutatePanels(state, (ps) =>
        ps.map((p) =>
          action.widths[p.id] !== undefined ? { ...p, widthMm: action.widths[p.id]!, locked: true } : p,
        ),
      );
    }

    // ── Stage 34: lock flag, default glass, notice ────────────────────────────
    case "SET_PANEL_LOCKED": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      const wanted = action.panelIds.filter((id) => {
        const p = panels.find((q) => q.id === id);
        return p && !!p.locked !== action.locked;
      });
      if (wanted.length === 0) return { ...state, notice: null };
      return mutatePanels(state, (ps) =>
        ps.map((p) => (wanted.includes(p.id) ? (action.locked ? { ...p, locked: true } : unlocked(p)) : p)),
      );
    }

    case "UNLOCK_ALL": {
      if (!state.draft) return state;
      const panels = state.draft.design?.panels ?? [];
      if (!panels.some((p) => p.locked)) return { ...state, notice: null };
      return mutatePanels(state, (ps) => ps.map(unlocked));
    }

    case "FILL_DEFAULT_GLASS": {
      if (!state.draft) return state;
      const filled = fillDefaultGlassPanels(
        state.draft.design?.panels ?? [],
        state.draft.heightMm,
        action.glassId,
      );
      if (!filled.changed) return state;
      return mutatePanels(state, () => filled.panels);
    }

    case "SET_NOTICE":
      return { ...state, notice: { code: action.code } };

    case "NOTIFY_LOCKED": {
      const lockedIds = action.panelIds.filter(
        (id) => !!state.draft?.design?.panels?.find((p) => p.id === id)?.locked,
      );
      return lockedIds.length > 0 ? { ...state, notice: { code: "PANEL_LOCKED", ids: lockedIds } } : state;
    }

    case "CLEAR_NOTICE":
      return state.notice ? { ...state, notice: null } : state;

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
  // The project's default glass (S34-7): the first GLASS Selection, in the API's orderIndex order.
  const defaultGlassId = selections.find((s) => s.componentType.code === "GLASS")?.id ?? null;
  const [state, dispatch] = useReducer(
    (st: DraftState, action: DraftAction) => draftReducer(st, action, defaultGlassId),
    initialDraftState,
  );

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
        return { ok: false, error: apiErrorMessage(body, "An unexpected error occurred — please try again.") };
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
          return { ok: false, error: apiErrorMessage(body, "Failed to rename room — please try again.") };
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
