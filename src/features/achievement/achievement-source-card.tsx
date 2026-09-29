import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { AchievementDetail as AchievementDetailData, AchievementRow } from "@/domain/achievement/contracts";
import { t, type Locale } from "@/i18n/messages";

type SourceFields = Pick<AchievementRow, "origin" | "source_excerpt" | "source_activity_revision">;

/** S08 provenance: the source Activity, or the excerpt copied from an imported CV. Read-only. */
export function AchievementSourceCard({
  locale,
  achievement,
  activity,
  detailReturn,
}: {
  locale: Locale;
  achievement: SourceFields;
  activity: AchievementDetailData["activity"] | null;
  detailReturn: string;
}) {
  if (!activity && !achievement.source_excerpt) return null;
  const imported = achievement.origin === "import";
  const sourceChanged = Boolean(activity && achievement.source_activity_revision && activity.revision !== achievement.source_activity_revision);
  return (
    <Card className="achievement-source-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t(locale, imported ? "achievement.importedFromCv" : "achievement.source")}</h2>
          <p className="field-help">{t(locale, imported ? "achievement.importedHelp" : "achievement.sourceHelp")}</p>
        </div>
        {activity ? <Link className="button-secondary" href={`/activity/${activity.id}?${new URLSearchParams({ returnTo: detailReturn }).toString()}`}>{t(locale, "activity.openActivity")}</Link> : null}
      </div>
      {sourceChanged ? <p className="ui-message ui-message--warning mt-3" role="status">{t(locale, "achievement.sourceChanged")}</p> : null}
      {activity ? <div className="achievement-source-preview mt-3"><p className="field-label">{t(locale, "activity.currentText")}</p><p>{activity.raw_text}</p></div> : null}
      {achievement.source_excerpt ? <div className="achievement-source-preview mt-3"><p className="field-label">{t(locale, "achievement.sourceExcerpt")}</p><p>{achievement.source_excerpt}</p></div> : null}
      {!imported && !activity && achievement.source_excerpt ? <p className="field-help mt-2">{t(locale, "achievement.sourceUnavailable")}</p> : null}
    </Card>
  );
}
