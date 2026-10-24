"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingLabel,
  loadingLabel,
  variant,
  className = "button-primary",
  disabled = false,
  ...props
}: Omit<ButtonProps, "loading"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const resolvedVariant = variant ?? (className === "button-danger"
    ? "destructive"
    : className === "button-secondary"
      ? "secondary"
      : "primary");
  const extraClass = ["button-primary", "button-secondary", "button-danger"].includes(className)
    ? ""
    : className;

  return (
    <Button
      {...props}
      variant={resolvedVariant}
      className={extraClass}
      type="submit"
      loading={pending}
      loadingLabel={pendingLabel ?? loadingLabel}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
