"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  focusTitle = false,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  /**
   * Start focus on the title instead of the first control, for a choice that must not be made by a stray Enter.
   * showModal() otherwise focuses the first focusable element.
   */
  focusTitle?: boolean;
  /** False while a request started in the dialog is running: Escape and the backdrop then leave it open. */
  dismissible?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      if (focusTitle) titleRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, focusTitle]);

  return (
    <dialog
      ref={dialogRef}
      className={["ui-dialog", className].filter(Boolean).join(" ")}
      aria-hidden={!open || undefined}
      inert={!open}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (!dismissible) {
          event.preventDefault();
          return;
        }
        onOpenChange(false);
      }}
      onClose={() => {
        if (dialogRef.current?.open) return;
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="ui-dialog-panel">
        <header className="space-y-2">
          <h2 id={titleId} ref={titleRef} tabIndex={focusTitle ? -1 : undefined} className="text-xl font-semibold tracking-tight">{title}</h2>
          <p id={descriptionId} className="text-sm text-[var(--color-text-secondary)]">{description}</p>
        </header>
        {children}
      </div>
    </dialog>
  );
}
