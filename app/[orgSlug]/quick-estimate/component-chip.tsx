/**
 * The component chip (mockup `.qe-chip`): an icon + the component name. GLASS (Partition) and DOOR get
 * their own icon, DOOR its own blue; any other usable type gets a generic box icon.
 */
const ICONS: Record<string, React.ReactNode> = {
  GLASS: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M12 4v16M7 8l2.5-2.5M14.5 10.5 18 7" />
    </>
  ),
  DOOR: (
    <>
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21M3 21h18" />
      <path d="M15 12.5h.01" />
    </>
  ),
};

const GENERIC = (
  <>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </>
);

export function ComponentChip({ code, name }: { code: string; name: string }) {
  return (
    <span className="qe-chip" data-kind={code === "DOOR" ? "door" : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[code] ?? GENERIC}
      </svg>
      {name}
    </span>
  );
}
