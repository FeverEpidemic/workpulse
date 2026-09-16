"use client";

import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";

export function Tooltip({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const id = useId();
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": id,
      })
    : children;

  return (
    <span className={`ui-tooltip ui-tooltip--${align}`}>
      {child}
      <span id={id} role="tooltip">{label}</span>
    </span>
  );
}
