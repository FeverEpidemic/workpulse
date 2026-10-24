"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { useNavigationLoading } from "@/components/layout/navigation-loading";

export function PendingLinkContent({ href = "", icon, children }: { href?: string; icon?: ReactNode; children: ReactNode }) {
  const { pending: linkPending } = useLinkStatus();
  const fallbackPending = useNavigationLoading(href);
  const pending = linkPending || fallbackPending;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Next supplies its status only to descendants of Link.
    const link = ref.current?.closest("a");
    if (!link) return;
    link.dataset.pending = String(pending);
    if (pending) link.setAttribute("aria-busy", "true");
    else link.removeAttribute("aria-busy");
  }, [pending]);
  return (
    <span ref={ref} className="pending-link-content" data-pending={String(pending)} data-link-pending={String(linkPending)}>
      {icon ? <span className="pending-link-icon">{icon}</span> : null}
      {pending ? <span className="pending-link-spinner"><LoadingIndicator size={14} /></span> : null}
      {children}
    </span>
  );
}
