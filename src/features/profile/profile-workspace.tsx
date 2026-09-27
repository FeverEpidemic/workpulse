import { AiConsentCard } from "@/features/profile/ai-consent-card";
import { FoundationEditors } from "@/features/profile/foundation-editors";
import { ProfileEditor } from "@/features/profile/profile-editor";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/i18n/messages";
import type {
  CertificationRow,
  EducationRow,
  ExperienceRow,
  ProfileRow,
  SkillRow,
} from "@/domain/database-types";
import { t } from "@/i18n/messages";
import type { createSupabaseServerClient } from "@/server/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function ProfileWorkspace({
  client,
  profile,
  userEmail,
  locale,
  openRecordId,
}: {
  client: ServerClient;
  profile: ProfileRow;
  userEmail: string;
  locale: Locale;
  openRecordId?: string;
}) {
  const [experienceResult, educationResult, certificationResult, skillResult, projectResult] = await Promise.all([
    client.from("experiences").select("*").eq("user_id", profile.id).order("start_date", { ascending: false, nullsFirst: false }),
    client.from("education").select("*").eq("user_id", profile.id).order("start_date", { ascending: false, nullsFirst: false }),
    client.from("certifications").select("*").eq("user_id", profile.id).order("issued_date", { ascending: false, nullsFirst: false }),
    client.from("skills").select("*").eq("user_id", profile.id).order("normalized_name", { ascending: true }),
    client.from("projects").select("experience_id", { count: "exact" }).eq("user_id", profile.id).not("experience_id", "is", null),
  ]);

  const recordsAvailable = !experienceResult.error && !educationResult.error && !certificationResult.error && !skillResult.error;
  const releaseCountUnavailable = Boolean(projectResult.error) || projectResult.count !== (projectResult.data?.length ?? 0);
  const releaseCounts: Record<string, number> = {};
  for (const row of projectResult.data ?? []) {
    if (row.experience_id) releaseCounts[row.experience_id] = (releaseCounts[row.experience_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="profile-title">
        <div>
          <h1 id="profile-title" className="text-3xl font-semibold tracking-tight">{t(locale, "profile.title")}</h1>
          <p className="mt-2 text-[var(--wp-muted)]">{t(locale, "profile.subtitle")}</p>
        </div>
        <Card className="space-y-5">
          <h2 className="text-xl font-semibold">{t(locale, "profile.personalDetails")}</h2>
          <ProfileEditor profile={profile} userEmail={userEmail} locale={locale} />
        </Card>
        <Card className="space-y-4">
          <AiConsentCard profile={profile} locale={locale} />
        </Card>
      </section>

      <section className="space-y-4" aria-labelledby="career-records-title">
        <div>
          <h2 id="career-records-title" className="text-2xl font-semibold tracking-tight">{t(locale, "profile.careerRecords")}</h2>
          <p className="mt-2 text-sm text-[var(--wp-muted)]">{t(locale, "profile.foundationDescription")}</p>
        </div>
        {!recordsAvailable ? (
          <Card role="alert">
            <p>{t(locale, "error.unavailable")}</p>
            <a className="button-secondary mt-3 inline-flex" href="/settings/profile">{t(locale, "common.retry")}</a>
          </Card>
        ) : (
          <FoundationEditors
            ownerId={profile.id}
            experiences={(experienceResult.data ?? []) as ExperienceRow[]}
            education={(educationResult.data ?? []) as EducationRow[]}
            certifications={(certificationResult.data ?? []) as CertificationRow[]}
            skills={(skillResult.data ?? []) as SkillRow[]}
            openRecordId={openRecordId}
            releaseCounts={releaseCounts}
            releaseCountUnavailable={releaseCountUnavailable}
            locale={locale}
          />
        )}
      </section>
    </div>
  );
}
