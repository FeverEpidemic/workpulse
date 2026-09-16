"use client";

import { signOutAction } from "@/server/auth/actions";
import { clearSessionDraftsForOwner } from "@/components/forms/session-draft";

export function SignOutForm({ ownerId, label, className = "button-secondary" }: {
  ownerId: string;
  label: string;
  className?: string;
}) {
  return (
    <form action={signOutAction} onSubmit={() => clearSessionDraftsForOwner(ownerId)}>
      <button className={className} type="submit">{label}</button>
    </form>
  );
}
