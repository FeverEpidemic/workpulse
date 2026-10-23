"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

const subscribeNever = () => () => {};

/** A page hydrated from a document load is already painted, so replaying the entry would blink it. */
export function shouldEnterWorkspace(hydrating: boolean): boolean {
  return !hydrating;
}

export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  // True only while React hydrates server HTML; a template mounted by a client navigation reads false.
  const hydrating = useSyncExternalStore(subscribeNever, () => false, () => true);
  const [enter] = useState(() => shouldEnterWorkspace(hydrating));
  return <div className="workspace-page-enter" data-page-enter={String(enter)}>{children}</div>;
}
