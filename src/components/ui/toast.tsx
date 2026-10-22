"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastKind = "success" | "danger";

interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
  leaving?: boolean;
}

export function scheduleToastLifecycle(onLeaving: () => void, onRemove: () => void): () => void {
  const leaving = setTimeout(onLeaving, 4380);
  const removal = setTimeout(onRemove, 4500);
  return () => { clearTimeout(leaving); clearTimeout(removal); };
}

type ToastSender = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastSender | null>(null);
const noToast: ToastSender = () => undefined;

export function ToastProvider({
  children,
  notificationsLabel,
}: {
  children: ReactNode;
  notificationsLabel: string;
}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, () => void>());

  const showToast = useCallback<ToastSender>((message, kind = "success") => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, kind }]);
    const cancel = scheduleToastLifecycle(() => {
      setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, leaving: true } : toast));
    }, () => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timers.current.delete(id);
    });
    timers.current.set(id, cancel);
  }, []);

  useEffect(() => () => {
    for (const cancel of timers.current.values()) cancel();
    timers.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="ui-toast-region" role="region" aria-label={notificationsLabel}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "danger" ? "alert" : "status"}
            aria-live={toast.kind === "danger" ? "assertive" : "polite"}
            className={"ui-toast ui-toast--" + toast.kind}
            data-leaving={toast.leaving || undefined}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastSender {
  return useContext(ToastContext) ?? noToast;
}
