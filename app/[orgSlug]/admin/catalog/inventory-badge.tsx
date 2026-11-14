"use client";

import { useEffect, useRef, useState } from "react";

interface InventoryBadgeProps {
  /** The chip's value (used in labels and test ids). */
  value: string;
  /** MANAGE_PRICING: the tooltip carries the icon-only add button; without it, text only. */
  canAdd: boolean;
  onAdd: (code: string) => void;
}

/**
 * Stage 35 Batch 8 — the round warning badge on the top corner of a chip whose value is not an active inventory
 * item of the type (mockup `inventory-badge.html`, option A). 17px visual inside a 24px hit area, focusable.
 * Hover, focus or tap opens a compact tooltip ("Not in inventory" + an icon-only "Add to inventory" button).
 * The tooltip is `position: fixed` from the badge rect because the editor body is an `overflow-y-auto` box that
 * would clip a chip-anchored one; it closes on scroll. Escape closes it without reaching the modal's own
 * Escape handler (same stopImmediatePropagation reasoning as the chip rename input).
 */
export function InventoryBadge({ value, canAdd, onAdd }: InventoryBadgeProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const open = hover || focus || pinned;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom, right: Math.max(8, window.innerWidth - r.right - 14) });
    };
    place();
    const close = () => {
      setHover(false);
      setFocus(false);
      setPinned(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPinned(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="absolute -right-[8px] -top-[10px] z-[1] h-6 w-6"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setHover(false);
        setFocus(false);
        setPinned(false);
      }}
    >
      <button
        type="button"
        data-testid="value-not-in-inventory"
        aria-label="Not in inventory"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        className="group flex h-6 w-6 items-center justify-center rounded-full outline-none"
      >
        <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 border-bg-white bg-[#B3261E] text-[10px] font-extrabold leading-none text-white shadow-[0_0_0_1px_#F3B8B2] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[#0B6E99]">
          !
        </span>
      </button>
      {open && pos && (
        <span role="tooltip" className="fixed z-50 pt-[7px]" style={{ top: pos.top, right: pos.right }}>
          <span className="relative flex items-center gap-2.5 whitespace-nowrap rounded-[10px] bg-[#1B281E] py-[5px] pl-[11px] pr-[5px] text-[12.5px] font-bold text-[#F4F6EE] shadow-[0_12px_24px_-12px_rgba(27,40,30,.5)]">
            <span className="absolute -top-1 right-[19px] h-2 w-2 rotate-45 bg-[#1B281E]" aria-hidden="true" />
            Not in inventory
            {canAdd && (
              <button
                type="button"
                data-testid="inventory-badge-add"
                aria-label="Add to inventory"
                title="Add to inventory"
                onClick={() => {
                  setHover(false);
                  setFocus(false);
                  setPinned(false);
                  onAdd(value);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-md bg-white/15 p-0 text-[#F4F6EE] hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B6E99]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 8l-9-5-9 5 9 5 9-5z" />
                  <path d="M3 8v8l9 5 9-5V8" />
                  <path d="M12 13v8" />
                  <circle cx="18.5" cy="18.5" r="5.5" fill="#4E7F58" stroke="#1B281E" strokeWidth="1.5" />
                  <path d="M18.5 16v5M16 18.5h5" stroke="#fff" strokeWidth="1.8" />
                </svg>
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
