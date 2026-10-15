"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { buildCombinations, type EstimateOption, type EstimateType } from "@/lib/quick-estimate/palette";
import { ComponentChip } from "./component-chip";

interface ItemPickerProps {
  /** The line's item trigger; the listbox is placed from its rectangle (read in effects only). */
  anchorRef: RefObject<HTMLElement | null>;
  types: EstimateType[];
  selectedCode: string | null;
  selectedText: string;
  onChoose: (type: EstimateType, option: EstimateOption) => void;
  /** `refocus` returns focus to the trigger (Esc, the explicit close); a click outside does not. */
  onClose: (refocus: boolean) => void;
}

interface Entry {
  type: EstimateType;
  option: EstimateOption;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

/**
 * Combined item picker (S33-5): one list grouped by component, a filter box on top, full variants only.
 * A local listbox (SelectField has no grouping or filter and is left untouched). `position: fixed` from the
 * trigger's rectangle at z-200 (above the dialog), flipping above/below by free space. It renders INSIDE the
 * dialog DOM so the focus trap covers it. Keyboard: arrows, Enter, Esc, Tab (closes and returns to the trigger).
 */
export function ItemPicker({ anchorRef, types, selectedCode, selectedText, onChoose, onClose }: ItemPickerProps) {
  const t = useTranslations("quickEstimate");
  const uid = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<CSSProperties | null>(null);

  const groups = useMemo(() => types.map((type) => ({ type, options: buildCombinations(type) })), [types]);
  const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const visible = useMemo(
    () =>
      groups
        .map((g) => ({
          type: g.type,
          options: g.options.filter((o) => {
            const hay = `${g.type.name} ${o.text}`.toLowerCase();
            return tokens.every((tok) => hay.includes(tok));
          }),
        }))
        .filter((g) => g.options.length > 0)
        .reduce<{ type: EstimateType; options: EstimateOption[]; start: number }[]>((acc, g) => {
          const start = acc.length === 0 ? 0 : acc[acc.length - 1].start + acc[acc.length - 1].options.length;
          acc.push({ ...g, start });
          return acc;
        }, []),
    [groups, tokens],
  );
  const flat: Entry[] = useMemo(() => visible.flatMap((g) => g.options.map((option) => ({ type: g.type, option }))), [visible]);

  // Start on the current selection (the list is unfiltered when the picker opens).
  const [active, setActive] = useState(() =>
    Math.max(0, flat.findIndex((e) => e.type.code === selectedCode && e.option.text === selectedText)),
  );
  const activeClamped = Math.min(active, Math.max(flat.length - 1, 0));

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const width = Math.max(r.width, 360);
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
      if (below >= 300 || below >= above) {
        setPos({ left, width, top: r.bottom + 4, maxHeight: Math.min(420, below) });
      } else {
        setPos({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(420, above) });
      }
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A press outside the picker and its trigger closes it (the trigger's own click toggles it).
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    document.getElementById(`${uid}-o${activeClamped}`)?.scrollIntoView({ block: "nearest" });
  }, [activeClamped, uid]);

  function choose(i: number) {
    const e = flat[i];
    if (e) onChoose(e.type, e.option);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeClamped + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeClamped - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeClamped);
    } else if (e.key === "Escape") {
      e.preventDefault(); // tells the popup's Esc handler this press is already handled
      onClose(true);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose(true);
    }
  }

  return (
    <div
      ref={pickerRef}
      className="qe-pk"
      role="dialog"
      aria-label={t("chooseItem")}
      style={pos ?? { visibility: "hidden", top: 0, left: 0 }}
    >
      <div className="qe-pk-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={onKeyDown}
          placeholder={t("search")}
          aria-label={t("search")}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-controls={`${uid}-list`}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={flat.length > 0 ? `${uid}-o${activeClamped}` : undefined}
        />
      </div>
      <div
        ref={listRef}
        id={`${uid}-list`}
        className="qe-pk-list"
        role="listbox"
        aria-label={t("options")}
        onMouseDown={(e) => e.preventDefault()}
      >
        {visible.length === 0 && <div className="qe-pk-none">{t("noMatch")}</div>}
        {visible.map((g) => (
          <Fragment key={g.type.code}>
            <div className="qe-pk-gh">
              <ComponentChip code={g.type.code} name={g.type.name} />
              <span className="qe-pk-gh-u">{g.type.unit}</span>
            </div>
            {g.options.map((option, n) => {
              const i = g.start + n;
              const isSel = g.type.code === selectedCode && option.text === selectedText;
              return (
                <div
                  key={option.text}
                  id={`${uid}-o${i}`}
                  role="option"
                  aria-selected={isSel}
                  className={`qe-pk-opt${i === activeClamped ? " qe-active" : ""}${isSel ? " qe-sel" : ""}`}
                  onMouseMove={() => i !== activeClamped && setActive(i)}
                  onClick={() => choose(i)}
                >
                  <span className="qe-pk-opt-t">
                    <Highlight text={option.text} tokens={tokens} />
                  </span>
                  <svg className="qe-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
