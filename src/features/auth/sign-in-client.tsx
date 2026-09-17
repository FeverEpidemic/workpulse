"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { LocaleSwitcher } from "@/components/forms/locale-switcher";
import { SubmitButton } from "@/components/forms/submit-button";
import { signInAction, signUpAction, requestRecoveryAction } from "@/server/auth/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { AUTH_FIELD_LIMITS } from "@/domain/profile/field-contract";

type AuthMode = "sign-in" | "create-account" | "recovery";

export function SignInClient({
  locale,
  returnTo,
  notice,
  configured,
}: {
  locale: Locale;
  returnTo: string;
  notice?: MessageKey;
  configured: boolean;
}) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [signInState, signIn, signingIn] = useActionState(signInAction, IDLE_ACTION_STATE);
  const [signUpState, signUp, signingUp] = useActionState(signUpAction, IDLE_ACTION_STATE);
  const [recoveryState, requestRecovery, requestingRecovery] = useActionState(requestRecoveryAction, IDLE_ACTION_STATE);
  const signInEmailErrorId = fieldErrorId("sign-in-form", "email");
  const signInPasswordErrorId = fieldErrorId("sign-in-form", "password");
  const signUpEmailErrorId = fieldErrorId("sign-up-form", "email");
  const signUpPasswordErrorId = fieldErrorId("sign-up-form", "password");
  const recoveryEmailErrorId = fieldErrorId("recovery-form", "email");

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl content-center gap-8 px-5 py-10 lg:grid-cols-[1fr_420px] lg:px-10">
      <section className="flex flex-col justify-center gap-6 py-6">
        <Link href="/" className="text-lg font-bold tracking-tight">WorkPulse</Link>
        <div className="max-w-xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--wp-muted)]">{t(locale, "auth.heroKicker")}</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t(locale, "auth.heroTitle")}</h1>
          <p className="max-w-lg text-lg leading-7 text-[var(--wp-muted)]">{t(locale, "auth.heroDescription")}</p>
        </div>
        <ol className="grid max-w-xl gap-3 text-sm text-[var(--wp-muted)] sm:grid-cols-3">
          <li className="rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-4">{t(locale, "auth.stepCapture")}</li>
          <li className="rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-4">{t(locale, "auth.stepReview")}</li>
          <li className="rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-4">{t(locale, "auth.stepCv")}</li>
        </ol>
      </section>

      <section className="app-card mx-auto w-full max-w-md space-y-5" aria-labelledby="auth-heading">
        <div>
          <p className="text-sm font-semibold text-[var(--wp-primary)]">{t(locale, "auth.welcome")}</p>
          <h2 id="auth-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            {mode === "recovery" ? t(locale, "auth.forgotPassword") : mode === "create-account" ? t(locale, "auth.createAccount") : t(locale, "auth.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--wp-muted)]">{t(locale, "auth.description")}</p>
        </div>

        {!configured ? <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{t(locale, "auth.notConfigured")}</p> : null}
        {notice ? <p role="status" className="rounded-lg bg-[var(--wp-subtle)] px-4 py-3 text-sm">{t(locale, notice)}</p> : null}

        {mode === "sign-in" ? (
          <form id="sign-in-form" action={signIn} className="space-y-4">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="field-label" htmlFor="sign-in-email">{t(locale, "auth.email")}
              <input className="field-input mt-1" id="sign-in-email" name="email" type="email" autoComplete="email" required maxLength={AUTH_FIELD_LIMITS.email} {...fieldErrorControlProps(signInState, "email", signInEmailErrorId)} />
            </label>
            <FieldError state={signInState} field="email" locale={locale} id={signInEmailErrorId} />
            <label className="field-label" htmlFor="sign-in-password">{t(locale, "auth.password")}
              <input className="field-input mt-1" id="sign-in-password" name="password" type="password" autoComplete="current-password" required maxLength={AUTH_FIELD_LIMITS.password} {...fieldErrorControlProps(signInState, "password", signInPasswordErrorId)} />
            </label>
            <FieldError state={signInState} field="password" locale={locale} id={signInPasswordErrorId} />
            <ActionFeedback state={signInState} locale={locale} returnTo={returnTo} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button className="text-sm font-semibold underline underline-offset-4" type="button" onClick={() => setMode("recovery")}>
                {t(locale, "auth.forgotPassword")}
              </button>
              <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "auth.signIn")}</SubmitButton>
            </div>
            <p className="border-t border-[var(--wp-border)] pt-4 text-sm text-[var(--wp-muted)]">
              {t(locale, "auth.noAccount")} {" "}
              <button className="font-semibold text-[var(--wp-primary)] underline underline-offset-4" type="button" onClick={() => setMode("create-account")}>
                {t(locale, "auth.createAccount")}
              </button>
            </p>
          </form>
        ) : null}

        {mode === "create-account" ? (
          <form id="sign-up-form" action={signUp} className="space-y-4">
            <label className="field-label" htmlFor="sign-up-email">{t(locale, "auth.email")}
              <input className="field-input mt-1" id="sign-up-email" name="email" type="email" autoComplete="email" required maxLength={AUTH_FIELD_LIMITS.email} {...fieldErrorControlProps(signUpState, "email", signUpEmailErrorId)} />
            </label>
            <FieldError state={signUpState} field="email" locale={locale} id={signUpEmailErrorId} />
            <label className="field-label" htmlFor="sign-up-password">{t(locale, "auth.password")}
              <input className="field-input mt-1" id="sign-up-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={AUTH_FIELD_LIMITS.password} required {...fieldErrorControlProps(signUpState, "password", signUpPasswordErrorId)} />
            </label>
            <FieldError state={signUpState} field="password" locale={locale} id={signUpPasswordErrorId} />
            <ActionFeedback state={signUpState} locale={locale} returnTo={returnTo} />
            <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "auth.createAccount")}</SubmitButton>
            <p className="text-sm text-[var(--wp-muted)]">
              {t(locale, "auth.haveAccount")} {" "}
              <button className="font-semibold text-[var(--wp-primary)] underline underline-offset-4" type="button" onClick={() => setMode("sign-in")}>
                {t(locale, "auth.signIn")}
              </button>
            </p>
          </form>
        ) : null}

        {mode === "recovery" ? (
          <form id="recovery-form" action={requestRecovery} className="space-y-4">
            <label className="field-label" htmlFor="recovery-email">{t(locale, "auth.email")}
              <input className="field-input mt-1" id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={AUTH_FIELD_LIMITS.email} {...fieldErrorControlProps(recoveryState, "email", recoveryEmailErrorId)} />
            </label>
            <FieldError state={recoveryState} field="email" locale={locale} id={recoveryEmailErrorId} />
            <ActionFeedback state={recoveryState} locale={locale} returnTo={returnTo} />
            <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "auth.sendRecovery")}</SubmitButton>
            <button className="block text-sm font-semibold underline underline-offset-4" type="button" onClick={() => setMode("sign-in")}>
              {t(locale, "auth.backToSignIn")}
            </button>
          </form>
        ) : null}

        <div className="border-t border-[var(--wp-border)] pt-4">
          <LocaleSwitcher locale={locale} />
        </div>
      </section>
    </main>
  );
}
