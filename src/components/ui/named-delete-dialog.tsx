"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function NamedDeleteDialog({
  title,
  description,
  recordName,
  triggerLabel,
  cancelLabel,
  confirmLabel,
  formId,
  disabled = false,
  successful = false,
  children,
}: {
  title: string;
  description: string;
  recordName: string;
  triggerLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  formId: string;
  disabled?: boolean;
  successful?: boolean;
  children: ReactNode;
}) {
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = requestedOpen && !successful;

  return (
    <>
      <Button
        variant="secondary"
        className="ui-delete-trigger"
        disabled={disabled}
        onClick={() => setRequestedOpen(true)}
      >
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setRequestedOpen} title={title} description={description}>
        <p className="mt-4 rounded-md bg-[var(--color-bg-subtle)] px-3 py-2 font-semibold">
          {recordName}
        </p>
        {children}
        <div className="ui-dialog-actions">
          <Button variant="secondary" autoFocus onClick={() => setRequestedOpen(false)}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" type="submit" form={formId}>
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
