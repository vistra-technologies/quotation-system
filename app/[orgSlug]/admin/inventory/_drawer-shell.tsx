"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * The modal behaviour of the Inventory item drawer (Q-D29), nothing else: a portal to `document.body` with a
 * click-to-close scrim, a 440 px right-hand panel, everything outside inert while it is open, focus moved in and
 * trapped, Escape and the scrim asking the owner to close, and focus returned to the opener on close.
 *
 * The owner decides whether a close is allowed (`onRequestClose`, for the unsaved-changes confirm) and passes any
 * confirm dialogs as `overlay` children so they render inside this tree (they stay interactive; the shell
 * ignores Escape while `escapeBlocked`).
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface DrawerShellProps {
  /** id of the element that names the dialog (the drawer title). */
  titleId: string;
  onRequestClose: () => void;
  /** True while a confirm dialog is open: Escape belongs to it, not to the drawer. */
  escapeBlocked?: boolean;
  /** Looked up on close: where focus should return (the list row, which can remount after a refresh). */
  getRestoreTarget?: () => HTMLElement | null;
  /** Rendered inside the scrim, outside the panel (confirm dialogs). */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}

export function DrawerShell({
  titleId,
  onRequestClose,
  escapeBlocked = false,
  getRestoreTarget,
  overlay,
  children,
}: DrawerShellProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef(getRestoreTarget);
  useEffect(() => {
    restoreRef.current = getRestoreTarget;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const scrim = scrimRef.current;
    // Everything else in the document goes inert; remember what already was so it is restored exactly.
    const touched: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === scrim || !(el instanceof HTMLElement) || el.inert) continue;
      el.inert = true;
      touched.push(el);
    }
    const first = panelRef.current?.querySelector<HTMLElement>("input,[role=combobox]");
    (first ?? panelRef.current)?.focus();

    return () => {
      for (const el of touched) el.inert = false;
      const target = restoreRef.current?.() ?? (opener && opener.isConnected ? opener : null);
      target?.focus();
    };
  }, []);

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      // A SelectField closing its own listbox already handled this Escape.
      if (e.defaultPrevented || escapeBlocked) return;
      e.preventDefault();
      e.stopPropagation();
      onRequestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const firstNode = nodes[0];
    const lastNode = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstNode || active === panelRef.current)) {
      e.preventDefault();
      lastNode.focus();
    } else if (!e.shiftKey && active === lastNode) {
      e.preventDefault();
      firstNode.focus();
    }
  }

  return createPortal(
    <div
      ref={scrimRef}
      className="fixed inset-0 z-40 flex cursor-pointer justify-end bg-[rgba(27,40,30,.14)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onRequestClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="flex h-full w-[440px] max-w-full cursor-auto flex-col border-l border-border bg-bg-white shadow-[-8px_0_24px_rgba(27,40,30,.1)] outline-none"
      >
        {children}
      </aside>
      {overlay}
    </div>,
    document.body,
  );
}
