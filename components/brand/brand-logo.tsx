import styles from "./brand.module.css";

interface BrandLogoProps {
  /** "md" = 40px mark / 22px wordmark (default); "sm" = 32px / 18px. */
  size?: "sm" | "md";
  /** "onDark" lightens the wordmark for use over the dark login scene. */
  tone?: "default" | "onDark";
  className?: string;
}

/**
 * EaseeTool logo — doc-icon mark + wordmark. Shared by the org login page and
 * the apex landing page (Stage 28). Server-safe (no hooks, no client APIs).
 */
export function BrandLogo({
  size = "md",
  tone = "default",
  className,
}: BrandLogoProps) {
  const cls = [
    styles.logo,
    size === "sm" ? styles.sm : "",
    tone === "onDark" ? styles.onDark : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className={styles.logoMark} aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="m9 15 2 2 4-4" />
        </svg>
      </div>
      <span className={styles.logoWord}>EaseeTool</span>
    </div>
  );
}
