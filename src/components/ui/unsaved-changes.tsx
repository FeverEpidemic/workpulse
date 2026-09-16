"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, FormEventHandler, MouseEvent, ReactNode } from "react";

import type { ActionState } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

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
} {
  const { markDirty, markClean } = useContext(UnsavedContext);

  useEffect(() => {
    if (state?.status === "success") markClean(formId);
  }, [formId, markClean, state]);

  const markCurrentDirty = useCallback((_event: FormEvent<HTMLFormElement>) => {
    markDirty(formId);
  }, [formId, markDirty]);

  return { onInputCapture: markCurrentDirty, onChangeCapture: markCurrentDirty };
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const sourceLink = useRef<HTMLAnchorElement | null>(null);
  const hasUnsavedChanges = dirtyForms.size > 0;

  const markDirty = useCallback((formId: string) => {
    setDirtyForms((current) => {
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

  const cancelNavigation = useCallback(() => {
    setDialogOpen(false);
    setPendingHref("");
    const link = sourceLink.current;
    sourceLink.current = null;
    requestAnimationFrame(() => link?.focus());
  }, []);

  const continueNavigation = useCallback(() => {
    const href = pendingHref;
    setDialogOpen(false);
    setPendingHref("");
    sourceLink.current = null;
    clearAll();
    if (href) router.push(href);
  }, [clearAll, pendingHref, router]);

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
