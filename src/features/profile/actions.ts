"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";

import { parseLocale, type MessageKey } from "@/i18n/messages";
import { onboardingFormSchema, profileFormSchema } from "@/features/profile/schemas";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";
import { persistLocaleCookie } from "@/server/locale/cookie";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function validationFailure(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): ActionState {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) {
    const key = issue.message.startsWith("validation.") ? issue.message as MessageKey : "error.validation";
    fieldErrors[String(issue.path[0] ?? "form")] = key;
  }
  return actionFailure("VALIDATION", "error.validation", { fieldErrors });
}

function databaseErrorCode(error: PostgrestError): "VALIDATION" | "UNAUTHENTICATED" | "UNAVAILABLE" {
  if (error.code === "42501") return "UNAUTHENTICATED";
  if (/^(22|23)/.test(error.code ?? "")) return "VALIDATION";
  return "UNAVAILABLE";
}

async function currentUser(client: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function currentProfileRecord(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
) {
  const { data } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
}

export async function completeOnboardingAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const cookieStore = await cookies();
  const parsed = onboardingFormSchema.safeParse({
    display_name: text(formData, "display_name"),
    locale: text(formData, "locale") || cookieStore.get("wp-locale")?.value || "en",
    timezone: text(formData, "timezone") || "UTC",
    expected_revision: text(formData, "expected_revision"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  let shouldRedirect = false;
  try {
    const client = await createSupabaseServerClient();
    const user = await currentUser(client);
    if (!user) return actionFailure("UNAUTHENTICATED", "auth.signInRequired");

    const { data, error } = await client.rpc("complete_onboarding", {
      p_display_name: parsed.data.display_name,
      p_locale: parsed.data.locale,
      p_timezone: parsed.data.timezone,
      p_expected_revision: parsed.data.expected_revision,
    });

    if (error) {
      if (error.code === "P0001" && error.message === "STALE_REVISION") {
        const latestRecord = await currentProfileRecord(client, user.id);
        return actionFailure("CONFLICT", "error.conflict", {
          latestRecord: latestRecord as unknown as Record<string, unknown> | undefined,
        });
      }
      if (error.code === "22023" && error.message === "INVALID_DISPLAY_NAME") {
        return actionFailure("VALIDATION", "error.validation", {
          fieldErrors: { display_name: "validation.displayName" },
        });
      }
      if (error.code === "22023" && error.message === "INVALID_LOCALE") {
        return actionFailure("VALIDATION", "error.validation", {
          fieldErrors: { locale: "validation.locale" },
        });
      }
      if (error.code === "22023" && error.message === "INVALID_TIMEZONE") {
        return actionFailure("VALIDATION", "error.validation", {
          fieldErrors: { timezone: "validation.timezone" },
        });
      }
      return actionFailure(databaseErrorCode(error), "error.validation");
    }

    if (!data?.[0]) {
      const latestRecord = await currentProfileRecord(client, user.id);
      return actionFailure("CONFLICT", "error.conflict", {
        latestRecord: latestRecord as unknown as Record<string, unknown> | undefined,
      });
    }

    try {
      await persistLocaleCookie(parsed.data.locale);
    } catch {
      // The profile locale is canonical; the cookie is only a pre-login fallback.
    }
    revalidatePath("/settings/profile");
    revalidatePath("/dashboard");
    shouldRedirect = true;
  } catch {
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }

  if (shouldRedirect) redirect("/dashboard");
  return actionSuccess("profile.saved");
}

export async function saveProfileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = profileFormSchema.safeParse({
    display_name: text(formData, "display_name"),
    headline: text(formData, "headline"),
    summary: text(formData, "summary"),
    contact_email: text(formData, "contact_email"),
    phone: text(formData, "phone"),
    location: text(formData, "location"),
    website: text(formData, "website"),
    locale: text(formData, "locale"),
    timezone: text(formData, "timezone"),
    expected_revision: text(formData, "expected_revision"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const client = await createSupabaseServerClient();
    const user = await currentUser(client);
    if (!user) return actionFailure("UNAUTHENTICATED", "auth.signInRequired");

    const {
      display_name,
      headline,
      summary,
      contact_email,
      phone,
      location,
      website,
      locale,
      timezone,
      expected_revision,
    } = parsed.data;

    const { data, error } = await client.rpc("update_profile", {
      p_expected_revision: expected_revision,
      p_changes: {
        display_name,
        headline,
        summary,
        contact_email,
        phone,
        location,
        website,
        locale,
        timezone,
      } satisfies Json as Json,
    });

    if (error) {
      if (error.code === "P0001" && error.message === "STALE_REVISION") {
        const latestRecord = await currentProfileRecord(client, user.id);
        return actionFailure("CONFLICT", "error.conflict", {
          latestRecord: latestRecord as unknown as Record<string, unknown> | undefined,
        });
      }
      return actionFailure(databaseErrorCode(error), "error.validation");
    }
    if (!data?.[0]) {
      const latestRecord = await currentProfileRecord(client, user.id);
      if (!latestRecord) return actionFailure("NOT_FOUND", "error.notFound");
      return actionFailure("CONFLICT", "error.conflict", {
        latestRecord: latestRecord as unknown as Record<string, unknown>,
      });
    }

    try {
      await persistLocaleCookie(parseLocale(locale));
    } catch {
      // The saved profile is the source of truth after sign-in.
    }
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return actionSuccess("profile.saved", data[0]);
  } catch {
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}
