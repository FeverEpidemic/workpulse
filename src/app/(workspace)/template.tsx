"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function shouldEnterWorkspace(previousPath: string | null, pathname: string): boolean {
  return previousPath !== pathname;
}

export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const key = "workpulse-workspace-path";
    let previous: string | null = null;
    try {
      previous = sessionStorage.getItem(key);
      sessionStorage.setItem(key, pathname);
    } catch {
      // GET filters also reload the document when session storage is disabled.
      if (document.referrer) {
        const from = new URL(document.referrer);
        if (from.origin === window.location.origin) previous = from.pathname;
      }
    }
    if (ref.current) ref.current.dataset.pageEnter = String(shouldEnterWorkspace(previous, pathname));
  }, [pathname]);
  return <div ref={ref} className="workspace-page-enter">{children}</div>;
}
