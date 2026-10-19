"use client";

/**
 * Generic right-click context menu primitive — S21-0.5.
 *
 * The app's first context menu. Supports: labelled items with optional icons,
 * disabled items (visually distinct, non-interactive), dividers, and custom
 * content slots (e.g. an embedded number input with standard-width buttons).
 *
 * Usage:
 *   - The trigger element calls `e.preventDefault()` on its `onContextMenu`
 *     event to suppress the native browser menu, then sets the anchor
 *     position in state.
 *   - Render <ContextMenu anchorX={x} anchorY={y} items={...} onClose={fn} />
 *     when you want the menu visible.
 *   - The menu positions itself so it always stays fully on-screen.
 *   - Dismiss: Escape, outside click, scroll.
 *
 * The native browser context menu is suppressed ONLY by the trigger's own
 * `onContextMenu` handler — this component never installs a global
 * `contextmenu` listener.
 */

import { useEffect, useRef, useState } from "react";

// ─── Item types ──────────────────────────────────────────────────────────────

export interface ContextMenuItem {
  type?: "item";
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

export interface ContextMenuDivider {
  type: "divider";
}

export interface ContextMenuCustomSlot {
  type: "custom";
  content: React.ReactNode;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider | ContextMenuCustomSlot;

// ─── Props ───────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  anchorX: number; // clientX from the contextmenu event
  anchorY: number; // clientY from the contextmenu event
  items: ContextMenuEntry[];
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MENU_WIDTH = 216;
const MENU_MAX_HEIGHT = 340;
const SCREEN_MARGIN = 8;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Context menu rendered at (anchorX, anchorY), repositioned to stay fully
 * on-screen. Dismisses on Escape, outside click, and scroll.
 */
export function ContextMenu({ anchorX, anchorY, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Viewport-aware position — mirrors mockup lines 1775-1777.
  const left = Math.max(
    SCREEN_MARGIN,
    Math.min(anchorX, (typeof window !== "undefined" ? window.innerWidth : 1920) - MENU_WIDTH - SCREEN_MARGIN),
  );
  const top = Math.max(
    SCREEN_MARGIN,
    Math.min(anchorY, (typeof window !== "undefined" ? window.innerHeight : 1080) - MENU_MAX_HEIGHT),
  );

  // Focus the first non-disabled item on open.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), input",
    );
    first?.focus();
  }, []);

  // Dismiss on Escape.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation(); // prevent Escape from also clearing Configure-mode selection
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  // Dismiss on outside click. Checked on mousedown (not click) against where
  // the press *started*: a click/drag that starts inside the menu (e.g.
  // dragging to select text in the width input) can end with the mouseup
  // outside the menu's DOM subtree, which makes the browser fire the `click`
  // event on an ancestor outside menuRef — closing the menu mid-interaction.
  // Keying off mousedown's start point avoids that false dismissal.
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Dismiss on scroll — but not on scrolls that happen inside the menu itself.
  // The listener is on window with capture:true, so it hears every element's
  // scroll, including a number input scrolling its own text once a 4th digit
  // overflows it; that must not read as "the page scrolled".
  useEffect(() => {
    function handleScroll(e: Event) {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    }
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 100 }}
      className="rounded-[12px] border border-[var(--color-border-strong)] bg-bg-white py-1.5 shadow-[0_16px_34px_-12px_rgba(27,40,30,.32)]"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, i) => {
        if (entry.type === "divider") {
          return (
            <div
              key={i}
              role="separator"
              className="my-1.5 mx-1 h-px bg-border"
            />
          );
        }

        if (entry.type === "custom") {
          return (
            <div key={i} className="px-2.5 py-1">
              {entry.content}
            </div>
          );
        }

        // Plain item (type === "item" or undefined)
        const item = entry as ContextMenuItem;
        return (
          <button
            key={i}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            title={item.disabled ? item.disabledTitle : undefined}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={[
              "flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left text-[13px] font-semibold text-text-heading",
              "border-none bg-transparent",
              item.disabled
                ? "cursor-not-allowed opacity-40"
                : "cursor-pointer hover:bg-primary-softer",
            ].join(" ")}
          >
            {item.icon && (
              <span className="flex w-4 shrink-0 items-center justify-center text-[13px] text-text-muted">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Embedded apply-width row ─────────────────────────────────────────────────

/**
 * Custom slot content for the "Apply width" row in the panel context menu.
 *
 * Stage 34 S34-2 (explicit apply): a typed value applies ONLY via the tick button or Enter. There is no
 * blur commit; clicking outside, right-clicking elsewhere or Escape unmounts the menu and discards the
 * draft. The caller decides what happens to the value: `onApply` receives the parsed number (NaN when
 * the field is not a number), and the caller closes the menu on success or passes `error` to keep it
 * open with an inline message.
 */
interface ApplyWidthSlotProps {
  label: string;
  tickLabel: string;
  initialValue: number;
  onApply: (widthMm: number) => void;
  /** Inline error from the last refused apply (keeps the menu open). */
  error?: string | null;
  /** Called when the user edits the field (the caller clears its error). */
  onDraftChange?: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

export function ApplyWidthSlot({
  label,
  tickLabel,
  initialValue,
  onApply,
  error,
  onDraftChange,
  disabled,
  disabledTitle,
}: ApplyWidthSlotProps) {
  const [value, setValue] = useState(String(initialValue));

  function apply() {
    onApply(parseFloat(value));
  }

  return (
    <div className="pb-2 pt-1" title={disabled ? disabledTitle : undefined}>
      <div className="flex items-center justify-between gap-2.5 px-0.5">
        <span className="text-[12.5px] font-semibold text-text-heading">{label}</span>
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            step="any"
            value={value}
            disabled={disabled}
            aria-label={`${label} (mm)`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              onDraftChange?.();
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              } else if (e.key === "Escape") {
                e.stopPropagation(); // handled by parent context menu
              }
            }}
            className={
              "w-[76px] rounded-[6px] border px-[7px] py-[5px] text-right text-[12.5px] text-text-heading focus:outline-none " +
              (error
                ? "border-red-600 bg-red-50"
                : "border-[var(--color-border-strong)] focus:border-primary") +
              (disabled ? " cursor-not-allowed opacity-50" : "")
            }
          />
          <button
            type="button"
            data-testid="apply-width-tick"
            title={tickLabel}
            aria-label={tickLabel}
            disabled={disabled}
            // mousedown is cancelled so the input keeps focus until the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              apply();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-primary-dark bg-primary text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 px-0.5 text-[11.5px] font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Standard-width buttons row ───────────────────────────────────────────────

/**
 * Custom slot content for the "Apply standard width" section in the panel context menu. The caller
 * applies the width and closes the menu on success (or shows its inline error and keeps it open).
 */
interface StandardWidthSlotProps {
  label: string;
  widths: number[];
  onApply: (widthMm: number) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

export function StandardWidthSlot({ label, widths, onApply, disabled, disabledTitle }: StandardWidthSlotProps) {
  return (
    <div className="pb-1" title={disabled ? disabledTitle : undefined}>
      <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.05em] text-text-muted">
        {label}
      </p>
      <div className="flex gap-1.5 px-2.5">
        {widths.map((w, i) => (
          <button
            key={w}
            type="button"
            data-testid={`standard-width-${i}`}
            disabled={disabled}
            onClick={() => onApply(w)}
            className="flex-1 rounded-[8px] border border-primary-soft bg-primary-softer px-1 py-2 text-[12px] font-bold text-primary-dark hover:border-primary hover:bg-[#e2ebe3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
