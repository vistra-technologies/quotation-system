// Stage 34 S34-9 (D-43): small sage spinner. No useTranslations, so it is safe under /controls too.
// `tone` follows the mockup: default sage ring, "onPrimary" (white ring on a green button), "danger".
interface SpinnerProps {
  size?: number;
  tone?: "default" | "onPrimary" | "danger";
  className?: string;
}

const TONES: Record<NonNullable<SpinnerProps["tone"]>, string> = {
  default: "border-primary-soft border-t-primary",
  onPrimary: "border-white/45 border-t-white",
  danger: "border-[var(--color-danger-border)] border-t-[var(--color-status-failed-text)]",
};

export function Spinner({ size = 12, tone = "default", className = "" }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderWidth: size >= 20 ? 2.5 : 2 }}
      className={`inline-block shrink-0 animate-spin rounded-full motion-reduce:[animation-duration:2s] ${TONES[tone]} ${className}`}
    />
  );
}
