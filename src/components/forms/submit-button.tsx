"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingLabel,
  className = "button-primary",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const variant = className === "button-danger"
    ? "destructive"
    : className === "button-secondary"
      ? "secondary"
      : "primary";
  const extraClass = ["button-primary", "button-secondary", "button-danger"].includes(className)
    ? ""
    : className;

  return (
    <Button
      variant={variant}
      className={extraClass}
      type="submit"
      loading={pending}
      loadingLabel={pendingLabel}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
