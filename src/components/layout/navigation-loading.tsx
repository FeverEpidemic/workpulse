"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createNavigationLoadingStore } from "@/components/layout/navigation-loading-store";

const LoadingContext = createContext<ReturnType<typeof createNavigationLoadingStore> | null>(null);
const subscribeIdle = () => () => {};
const idle = () => false;

export function NavigationLoadingProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createNavigationLoadingStore);
  return <LoadingContext.Provider value={store}>{children}</LoadingContext.Provider>;
}

export function useNavigationLoading(href: string): boolean {
  const store = useContext(LoadingContext);
  return useSyncExternalStore(store?.subscribe ?? subscribeIdle, () => store?.isLoading(href) ?? false, idle);
}

export function useNavigationLoadingFallback(): void {
  const store = useContext(LoadingContext);
  const pathname = usePathname();
  useEffect(() => {
    if (store && pathname) return store.register(pathname);
  }, [store, pathname]);
}
