"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, FormEventHandler, MouseEvent, ReactNode } from "react";

import type { ActionState } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { historyEntryIndex, historyStateWithIndex, historyTraversalDelta } from "@/domain/routes/unsaved-navigation";

interface UnsavedContextValue {
  markDirty: (formId: string) => void;
  markClean: (formId: string) => void;
}

const UnsavedContext = createContext<UnsavedContextValue>({
  markDirty: () => undefined,
  markClean: () => undefined,
});

export function clearUnsavedForm(formId: string): void {
  window.dispatchEvent(new CustomEvent("workpulse:form-clean", { detail: { formId } }));
}

export function useUnsavedForm(formId: string, state?: ActionState): {
  onInputCapture: FormEventHandler<HTMLFormElement>;
  onChangeCapture: FormEventHandler<HTMLFormElement>;
  markDirty: () => void;
  markClean: () => void;
} {
  const { markDirty, markClean } = useContext(UnsavedContext);

  useEffect(() => {
    if (state?.status === "success") markClean(formId);
  }, [formId, markClean, state]);

  const markCurrentDirty = useCallback((_event: FormEvent<HTMLFormElement>) => {
    markDirty(formId);
  }, [formId, markDirty]);
  const markDirtyForm = useCallback(() => markDirty(formId), [formId, markDirty]);
  const markCurrentClean = useCallback(() => markClean(formId), [formId, markClean]);

  return {
    onInputCapture: markCurrentDirty,
    onChangeCapture: markCurrentDirty,
    markDirty: markDirtyForm,
    markClean: markCurrentClean,
  };
}

export function UnsavedChangesProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dirtyForms, setDirtyForms] = useState<Set<string>>(() => new Set());
  const [pendingHref, setPendingHref] = useState("");
  const [pendingHistoryDelta, setPendingHistoryDelta] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const sourceLink = useRef<HTMLAnchorElement | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const historyIndexRef = useRef(0);
  const historyRestoreRef = useRef<{ sourceIndex: number; delta: number } | null>(null);
  const historyFocusRef = useRef<{
    element: HTMLElement;
    selectionStart: number | null;
    selectionEnd: number | null;
    selectionDirection: "forward" | "backward" | "none" | null;
  } | null>(null);
  const hasUnsavedChanges = dirtyForms.size > 0;
  useLayoutEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const markDirty = useCallback((formId: string) => {
    setDirtyForms((current) => {
      if (current.has(formId)) return current;
      const next = new Set(current);
      next.add(formId);
      return next;
    });
  }, []);

  const markClean = useCallback((formId: string) => {
    setDirtyForms((current) => {
      if (!current.has(formId)) return current;
      const next = new Set(current);
      next.delete(formId);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setDirtyForms(new Set()), []);

  useEffect(() => {
    function handleFormClean(event: Event) {
      const detail = (event as CustomEvent<{ formId?: string }>).detail;
      if (detail?.formId) markClean(detail.formId);
    }
    window.addEventListener("workpulse:form-clean", handleFormClean);
    return () => window.removeEventListener("workpulse:form-clean", handleFormClean);
  }, [markClean]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const currentEntryIndex = historyEntryIndex(window.history.state);
    historyIndexRef.current = currentEntryIndex ?? 0;

    if (currentEntryIndex === null) {
      originalReplaceState(historyStateWithIndex(window.history.state, historyIndexRef.current), "");
    }

    function guardedPushState(data: unknown, unused: string, url?: string | URL | null): void {
      const nextIndex = historyIndexRef.current + 1;
      originalPushState(historyStateWithIndex(data, nextIndex), unused, url);
      historyIndexRef.current = nextIndex;
    }

    function guardedReplaceState(data: unknown, unused: string, url?: string | URL | null): void {
      const nextIndex = historyEntryIndex(data) ?? historyIndexRef.current;
      originalReplaceState(historyStateWithIndex(data, nextIndex), unused, url);
      historyIndexRef.current = nextIndex;
    }

    function handlePopState(event: PopStateEvent): void {
      const currentIndex = historyIndexRef.current;
      const targetIndex = historyEntryIndex(event.state);
      const restore = historyRestoreRef.current;

      if (restore && targetIndex === restore.sourceIndex) {
        historyRestoreRef.current = null;
        historyIndexRef.current = restore.sourceIndex;
        event.preventDefault();
        event.stopImmediatePropagation();
        setDialogOpen(true);
        return;
      }

      const delta = historyTraversalDelta(currentIndex, event.state);
      if (delta === 0) return;

      if (!hasUnsavedChangesRef.current) {
        historyIndexRef.current = targetIndex ?? currentIndex + delta;
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      historyRestoreRef.current = { sourceIndex: currentIndex, delta };
      setPendingHistoryDelta(delta);

      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const selectionControl = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
          ? active
          : null;
        historyFocusRef.current = {
          element: active,
          selectionStart: selectionControl?.selectionStart ?? null,
          selectionEnd: selectionControl?.selectionEnd ?? null,
          selectionDirection: selectionControl?.selectionDirection ?? null,
        };
      }

      window.history.go(-delta);
    }

    window.history.pushState = guardedPushState;
    window.history.replaceState = guardedReplaceState;
    window.addEventListener("popstate", handlePopState, true);

    return () => {
      window.removeEventListener("popstate", handlePopState, true);
      if (window.history.pushState === guardedPushState) window.history.pushState = originalPushState;
      if (window.history.replaceState === guardedReplaceState) window.history.replaceState = originalReplaceState;
    };
  }, []);

  const cancelNavigation = useCallback(() => {
    setDialogOpen(false);
    setPendingHref("");
    const wasHistoryNavigation = pendingHistoryDelta !== null;
    setPendingHistoryDelta(null);
    const link = sourceLink.current;
    sourceLink.current = null;
    if (wasHistoryNavigation) {
      const savedFocus = historyFocusRef.current;
      historyFocusRef.current = null;
      requestAnimationFrame(() => {
        if (!savedFocus?.element.isConnected || savedFocus.element.hasAttribute("disabled")) return;
        savedFocus.element.focus({ preventScroll: true });
        if (
          (savedFocus.element instanceof HTMLInputElement || savedFocus.element instanceof HTMLTextAreaElement) &&
          savedFocus.selectionStart !== null && savedFocus.selectionEnd !== null
        ) {
          savedFocus.element.setSelectionRange(
            savedFocus.selectionStart,
            savedFocus.selectionEnd,
            savedFocus.selectionDirection ?? undefined,
          );
        }
      });
    } else {
      requestAnimationFrame(() => link?.focus());
    }
  }, [pendingHistoryDelta]);

  const continueNavigation = useCallback(() => {
    const href = pendingHref;
    const historyDelta = pendingHistoryDelta;
    setDialogOpen(false);
    setPendingHref("");
    setPendingHistoryDelta(null);
    historyFocusRef.current = null;
    sourceLink.current = null;
    clearAll();
    if (historyDelta !== null) window.history.go(historyDelta);
    else if (href) router.push(href);
  }, [clearAll, pendingHistoryDelta, pendingHref, router]);

  const guardInternalNavigation = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!hasUnsavedChanges || event.defaultPrevented || !(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    const href = destination.pathname + destination.search + destination.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (href === current) return;

    event.preventDefault();
    event.stopPropagation();
    sourceLink.current = link;
    setPendingHref(href);
    setDialogOpen(true);
  }, [hasUnsavedChanges]);

  const value = { markDirty, markClean };

  return (
    <UnsavedContext.Provider value={value}>
      <div onClickCapture={guardInternalNavigation}>
        {children}
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (open) setDialogOpen(true);
            else cancelNavigation();
          }}
          title={t(locale, "common.unsavedTitle")}
          description={t(locale, "common.unsavedDescription")}
        >
          <div className="ui-dialog-actions">
            <Button variant="secondary" autoFocus onClick={cancelNavigation}>
              {t(locale, "common.unsavedStay")}
            </Button>
            <Button variant="primary" onClick={continueNavigation}>
              {t(locale, "common.unsavedContinue")}
            </Button>
          </div>
        </Dialog>
      </div>
    </UnsavedContext.Provider>
  );
}
