import Link from "next/link";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
  icon?: ReactNode;
}) {
  return (
    <section className="app-card flex min-h-56 flex-col items-start justify-center gap-3" aria-labelledby="empty-state-title">
      {icon ? <span className="grid size-11 place-items-center rounded-xl bg-[var(--color-bg-subtle)] text-[var(--color-action-primary)]">{icon}</span> : null}
      <div className="space-y-1">
        <h2 id="empty-state-title" className="text-lg font-semibold">{title}</h2>
        <p className="max-w-2xl text-sm text-[var(--color-text-secondary)]">{description}</p>
      </div>
      {action ? (
        <Link className="button-primary mt-1" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
