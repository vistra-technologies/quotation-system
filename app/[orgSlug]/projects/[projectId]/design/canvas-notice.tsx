"use client";

/**
 * The Design canvas notice (Stage 34, D-12 / D-16): ONE line overlaid on the canvas card's bottom padding,
 * so it never adds a row and the wall's drawn height cannot change. Renders every notice kind:
 *   - width/lock refusals (red, role="alert"), e.g. "Unlock a panel to absorb the difference";
 *   - "Panel is locked" / "N locked panels skipped" with an "Unlock" link that unlocks the panels it is about;
 *   - "N locked panels kept their glass" (neutral status, no link).
 *
 * Kept as its own small component, fed only by `state.notice`, so an in-rail renderer (the mockup's
 * placement, D-16 pending human) can be added next to it without touching the reducer.
 */

import { useTranslations } from "next-intl";
import type { DraftNotice } from "./design-draft-context";
import { LockIcon, UnlockIcon } from "./lock-icons";

interface CanvasNoticeProps {
  notice: DraftNotice | null;
  /** Unlock the panels a lock notice is about. */
  onUnlock: (panelIds: string[]) => void;
}

export function CanvasNotice({ notice, onUnlock }: CanvasNoticeProps) {
  const t = useTranslations("design");
  if (!notice) return null;

  const base =
    "pointer-events-none absolute inset-x-0 bottom-[2px] flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap px-[26px] text-[11.5px] font-semibold leading-[16px]";

  if (notice.code === "GLASS_KEPT") {
    return (
      <p role="status" data-testid="canvas-notice" data-notice="GLASS_KEPT" className={base + " text-[var(--color-panel-label)]"}>
        <LockIcon size={12} />
        {t("glassKept", { n: notice.skipped ?? 0 })}
      </p>
    );
  }

  if (notice.code === "PANEL_LOCKED" || notice.code === "LOCKED_SKIPPED") {
    const ids = notice.ids ?? [];
    const text =
      notice.code === "LOCKED_SKIPPED"
        ? t("lockedSkipped", { n: notice.skipped ?? ids.length })
        : ids.length > 1
          ? t("panelsAreLocked", { n: ids.length })
          : t("panelIsLocked");
    return (
      <p role="alert" data-testid="canvas-notice" data-notice={notice.code} className={base + " text-red-600"}>
        <span className="truncate">{text}</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          data-testid="canvas-notice-unlock"
          // The notice is outside any panel: stop the card's click-to-deselect from firing.
          onClick={(e) => {
            e.stopPropagation();
            onUnlock(ids);
          }}
          className="pointer-events-auto inline-flex shrink-0 items-center gap-[3px] font-bold text-primary-dark underline underline-offset-2"
        >
          <UnlockIcon size={12} />
          {t("unlockLink")}
        </button>
      </p>
    );
  }

  return (
    <p role="alert" data-testid="canvas-notice" data-notice={notice.code} className={base + " truncate text-red-600"}>
      {t(`widthRefusal${notice.code}`)}
    </p>
  );
}
