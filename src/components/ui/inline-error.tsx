import type { ReactNode } from "react";

export function InlineError({
  children,
  correlationId,
  className = "",
}: {
  children: ReactNode;
  correlationId?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={["ui-message ui-message--danger space-y-2", className].filter(Boolean).join(" ")}>
      {children}
      {correlationId ? <p className="text-xs opacity-80">{correlationId}</p> : null}
    </div>
  );
}
