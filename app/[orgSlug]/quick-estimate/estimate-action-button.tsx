"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";

interface EstimateActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "disabled"> {
  /** The Quick Estimate setup guard passed (S33-2). When false the button is disabled with the icon's tooltip (D-27). */
  enabled: boolean;
  /** Receives the clicked button, so the popup can return focus to it. */
  onClick: (trigger: HTMLButtonElement) => void;
  /** Where the tooltip opens: above for the bottom action bars, below for header tools. */
  placement?: "above" | "below";
  /** Which edge of the button the tooltip lines up with (`right` for tools at the right edge of a header). */
  align?: "left" | "right";
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

/**
 * A button that opens the estimate popup. Guard off: `aria-disabled` plus the same tooltip string and pattern as
 * the disabled top-bar calculator icon (`quickEstimate.disabledTip`); it stays focusable so the tooltip shows
 * on keyboard focus, and a click does nothing.
 */
export function EstimateActionButton({ enabled, onClick, placement = "above", align = "left", buttonRef, className, children, ...rest }: EstimateActionButtonProps) {
  const t = useTranslations("quickEstimate");
  const tipId = useId();
  return (
    <span className="group relative inline-flex">
      <button
        {...rest}
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          if (enabled) onClick(e.currentTarget);
        }}
        aria-disabled={enabled ? undefined : true}
        aria-describedby={enabled ? undefined : tipId}
        className={`${className ?? ""}${enabled ? "" : " cursor-not-allowed opacity-50"}`}
      >
        {children}
      </button>
      {!enabled && (
        <span
          id={tipId}
          role="tooltip"
          className={`pointer-events-none invisible absolute z-50 w-60 rounded-sm bg-text-heading px-[11px] py-[9px] text-left text-xs font-semibold leading-[1.45] text-white opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {t("disabledTip")}
        </span>
      )}
    </span>
  );
}
