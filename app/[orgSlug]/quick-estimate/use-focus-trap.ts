import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  // The currency <select> is visually hidden with tabIndex -1, so it is excluded by the selector above.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab / Shift+Tab inside `rootRef` while it is mounted (Stage 33, S33-10), so keyboard focus can't
 * reach the page behind the modal. Anything rendered inside the root counts (the item picker and the
 * currency list render inside the dialog DOM for exactly that reason). Returning focus to the opener is
 * the caller's job (TopBarActions focuses the calculator icon on close).
 */
export function useFocusTrap(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rootRef]);
}
