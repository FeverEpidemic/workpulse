import type { HTMLAttributes } from "react";

export function Skeleton({
  className = "",
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={["ui-skeleton", className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
