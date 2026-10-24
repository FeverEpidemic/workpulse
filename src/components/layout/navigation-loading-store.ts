function routePath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value.split(/[?#]/)[0]!.replace(/\/$/, "") || "/";
}

export function matchesNavigationDestination(href: string, pathname: string): boolean {
  const destination = routePath(href);
  const path = routePath(pathname);
  return destination !== null && path !== null && (destination === path || (destination !== "/" && path.startsWith(`${destination}/`)));
}

export function createNavigationLoadingStore() {
  const mounts = new Map<symbol, string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    register(pathname: string) {
      const token = Symbol();
      mounts.set(token, pathname);
      notify();
      return () => { if (mounts.delete(token)) notify(); };
    },
    isLoading(href: string) {
      return [...mounts.values()].some((path) => matchesNavigationDestination(href, path));
    },
  };
}
