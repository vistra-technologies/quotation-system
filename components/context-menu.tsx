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

  // Dismiss on outside click (menu's own content calls stopPropagation).
  useEffect(() => {
    function handleClick() { onClose(); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClose]);

  // Dismiss on scroll.
  useEffect(() => {
    function handleScroll() { onClose(); }
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
 * Custom slot content for the "Apply width" row in the panel context menu
 * (mockup lines 1825-1844). The embedded number input accepts Enter to apply
 * without closing the menu prematurely — it only calls onApply on Enter/blur,
 * and onClose is NOT called by Enter (matching mockup behaviour: the user
 * sees the result first).
 */
interface ApplyWidthSlotProps {
  label: string;
  initialValue: number;
  onApply: (widthMm: number) => void;
}

export function ApplyWidthSlot({ label, initialValue, onApply }: ApplyWidthSlotProps) {
  const [value, setValue] = useState(String(initialValue));

  function commit() {
    const parsed = parseFloat(value);
    if (!isFinite(parsed) || parsed <= 0) return;
    onApply(Math.round(parsed));
  }

  return (
    <div className="flex items-center justify-between gap-2.5 px-0.5 pb-2 pt-1">
      <span className="text-[12.5px] font-semibold text-text-heading">{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            // Do NOT close the menu on Enter — user sees the result first
          } else if (e.key === "Escape") {
            e.stopPropagation(); // handled by parent context menu
          }
        }}
        onBlur={commit}
        className="w-[60px] rounded-[6px] border border-[var(--color-border-strong)] px-[7px] py-[5px] text-right text-[12.5px] text-text-heading focus:border-primary focus:outline-none"
      />
    </div>
  );
}

// ─── Standard-width buttons row ───────────────────────────────────────────────

/**
 * Custom slot content for the "Apply standard width" section in the panel
 * context menu (mockup lines 1846-1866).
 */
interface StandardWidthSlotProps {
  label: string;
  widths: number[];
  onApply: (widthMm: number) => void;
  onClose: () => void;
}

export function StandardWidthSlot({ label, widths, onApply, onClose }: StandardWidthSlotProps) {
  return (
    <div className="pb-1">
      <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.05em] text-text-muted">
        {label}
      </p>
      <div className="flex gap-1.5 px-2.5">
        {widths.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => { onApply(w); onClose(); }}
            className="flex-1 rounded-[8px] border border-primary-soft bg-primary-softer px-1 py-2 text-[12px] font-bold text-primary-dark hover:border-primary hover:bg-[#e2ebe3]"
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
