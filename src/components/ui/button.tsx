import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { LoadingIndicator } from "@/components/ui/loading-indicator";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  ghost: "ui-button-ghost",
  destructive: "button-danger",
};

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [variantClass[variant], className].filter(Boolean).join(" ");
  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      data-ui-button="true"
    >
      {loading ? <span className="ui-button-spinner" aria-hidden="true"><LoadingIndicator size={14} /></span> : null}
      {children}
      {loading && loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
    </button>
  );
}

export function IconButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; "aria-label": string }) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={["ui-icon-button", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
