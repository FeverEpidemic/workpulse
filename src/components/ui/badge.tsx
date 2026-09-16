import type { HTMLAttributes, ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

export function Badge({
  children,
  variant = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; variant?: BadgeVariant }) {
  return (
    <span
      {...props}
      className={["ui-badge", "ui-badge--" + variant, className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}
