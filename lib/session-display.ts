/**
 * Display helpers for the "another session is active" login dialog
 * (hotfix 2026-10-02, single-session-confirm). Pure — no DOM, no better-auth.
 */

/** "Browser · OS" from a User-Agent string; "Unknown device" if neither is recognised. */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  // Order matters: Edge/Opera UAs also contain "Chrome", Chrome's contains "Safari".
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;

  // Android/iOS UAs also contain "Linux"/"Mac OS X", so test them first.
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux|X11/.test(userAgent)
            ? "Linux"
            : null;

  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? "Unknown device";
}

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(then: Date | string | number, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(then).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}
