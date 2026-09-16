import type { ReactNode } from "react";

export function RevisionConflict({
  title,
  labelledBy,
  children,
}: {
  title: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <section
      className="ui-message ui-message--warning space-y-2"
      role="group"
      aria-labelledby={labelledBy}
    >
      <h3 id={labelledBy} className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}
