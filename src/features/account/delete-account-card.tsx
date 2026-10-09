"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";

import { FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field-control";
import { InlineError } from "@/components/ui/inline-error";
import { accountDeletionPreviewSchema, type AccountDeletionPreview } from "@/domain/account/deletion";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE } from "@/server/action-result";

import { deleteAccountAction, getAccountDeletionPreviewAction } from "./actions";
import { deletionConfirmEnabled, deletionErrorIsFieldBound, deletionFocusTarget, previewLines } from "./delete-account-state";

const FORM_ID = "delete-account-form";
const errorIds = {
  password: fieldErrorId(FORM_ID, "password"),
  confirmation: fieldErrorId(FORM_ID, "confirmation"),
};

type PreviewState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; preview: AccountDeletionPreview };

/**
 * S12 "Privacy and account": explains what deletion removes and when, and opens one confirmation dialog.
 * The password and the typed email are only sent with the single submit; a failed attempt clears the password.
 */
export function DeleteAccountCard({ accountEmail, locale }: { accountEmail: string; locale: Locale }) {
  const [state, formAction, pending] = useActionState(deleteAccountAction, IDLE_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const handledResult = useRef<string | null>(null);

  async function openDialog() {
    setTyped("");
    setPreview({ status: "loading" });
    setOpen(true);
    const result = await getAccountDeletionPreviewAction();
    const parsed = result.status === "success" ? accountDeletionPreviewSchema.safeParse(result.data) : null;
    setPreview(parsed?.success ? { status: "ready", preview: parsed.data } : { status: "unavailable" });
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setTyped("");
  }

  // Focus enters the password field when the dialog opens and returns to the trigger when it closes.
  useEffect(() => {
    if (open) passwordRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // A failed attempt clears the password and puts focus on what needs fixing.
  useEffect(() => {
    if (state.status !== "error") return;
    if (handledResult.current === state.error.correlationId) return;
    handledResult.current = state.error.correlationId;
    if (passwordRef.current) passwordRef.current.value = "";
    const target = deletionFocusTarget(state);
    if (target === "password") passwordRef.current?.focus();
    else if (target === "confirmation") confirmationRef.current?.focus();
    else alertRef.current?.focus();
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deletionConfirmEnabled(accountEmail, typed, pending)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const showAlert = state.status === "error" && !deletionErrorIsFieldBound(state);

  return (
    <div className="delete-account">
      <h2 className="text-xl font-semibold">{t(locale, "account.delete.title")}</h2>
      <p className="text-sm text-[var(--wp-muted)]">{t(locale, "account.delete.privacy")}</p>
      <div>
        <button ref={triggerRef} type="button" className="button-secondary" onClick={() => void openDialog()}>
          {t(locale, "account.delete.trigger")}
        </button>
      </div>

      <Dialog open={open} onOpenChange={changeOpen} title={t(locale, "account.delete.dialogTitle")} description={t(locale, "account.delete.dialogDescription")}>
        <form id={FORM_ID} className="delete-account-form" onSubmit={submit} noValidate>
          <section className="delete-account-preview" aria-labelledby="delete-account-preview-title">
            <h3 id="delete-account-preview-title" className="delete-account-heading">{t(locale, "account.delete.previewHeading")}</h3>
            {preview.status === "loading" ? (
              <p role="status" className="text-sm">{t(locale, "account.delete.previewLoading")}</p>
            ) : preview.status === "unavailable" ? (
              <p className="text-sm">{t(locale, "account.delete.previewUnavailable")}</p>
            ) : (
              <ul className="delete-account-counts">
                {previewLines(preview.preview).map((line) => (
                  <li key={line.key}>{t(locale, line.key, line.params)}</li>
                ))}
              </ul>
            )}
          </section>

          <div>
            <label className="field-label" htmlFor="delete-account-password">{t(locale, "account.delete.passwordLabel")}</label>
            <Input
              ref={passwordRef}
              className="mt-1"
              id="delete-account-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              {...fieldErrorControlProps(state, "password", errorIds.password, ["delete-account-password-help"])}
            />
            <p id="delete-account-password-help" className="field-help">{t(locale, "account.delete.passwordHelp")}</p>
            <FieldError state={state} field="password" locale={locale} id={errorIds.password} />
          </div>

          <div>
            <label className="field-label" htmlFor="delete-account-confirmation">{t(locale, "account.delete.confirmLabel")}</label>
            <Input
              ref={confirmationRef}
              className="mt-1"
              id="delete-account-confirmation"
              name="confirmation"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              {...fieldErrorControlProps(state, "confirmation", errorIds.confirmation, ["delete-account-confirmation-help"])}
            />
            <p id="delete-account-confirmation-help" className="field-help delete-account-help">
              {t(locale, "account.delete.confirmHelp", { email: accountEmail })}
            </p>
            <FieldError state={state} field="confirmation" locale={locale} id={errorIds.confirmation} />
          </div>

          <div ref={alertRef} tabIndex={-1} className="delete-account-alert">
            {showAlert && state.status === "error" ? (
              <InlineError correlationId={state.error.correlationId}>
                <p>{t(locale, state.error.messageKey)}</p>
                {state.error.code === "UNAUTHENTICATED" ? (
                  <Link className="font-semibold underline underline-offset-4" href="/sign-in?returnTo=%2Fsettings%2Fprofile">
                    {t(locale, "auth.signIn")}
                  </Link>
                ) : null}
              </InlineError>
            ) : null}
          </div>

          <div className="ui-dialog-actions">
            <Button variant="secondary" onClick={() => changeOpen(false)}>{t(locale, "account.delete.cancel")}</Button>
            <Button
              variant="destructive"
              type="submit"
              disabled={!deletionConfirmEnabled(accountEmail, typed, pending)}
              loading={pending}
              loadingLabel={t(locale, "account.delete.submitting")}
            >
              {t(locale, "account.delete.confirm")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
