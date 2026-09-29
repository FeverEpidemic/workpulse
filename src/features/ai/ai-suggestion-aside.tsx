import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ApplyBlockReason } from "@/domain/ai/analysis-view";
import type { DetectResult } from "@/domain/ai/detect-result";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

const REASON_KEYS: Partial<Record<ApplyBlockReason, MessageKey>> = {
  ACHIEVEMENT_CONFIRMED: "error.achievementConfirmed",
  ACHIEVEMENT_DISMISSED: "error.achievementDismissed",
  DRAFT_EDITED: "error.draftEdited",
};

/** S08 read-only newer AI suggestion. It never overwrites the Achievement; the user copies from it. */
export function AiSuggestionAside({
  locale,
  suggestion,
  blockReason,
}: {
  locale: Locale;
  suggestion: NonNullable<DetectResult["suggestion"]>;
  blockReason: ApplyBlockReason | null;
}) {
  const reasonKey = blockReason ? REASON_KEYS[blockReason] : undefined;
  const rows: Array<[MessageKey, string | null]> = [
    ["ai.analysis.field.title", suggestion.title],
    ["ai.analysis.field.contribution", suggestion.contribution],
    ["ai.analysis.field.outcome", suggestion.outcome],
    ["ai.analysis.field.cvBullet", suggestion.cv_bullet],
  ];
  return (
    <Card className="ai-analysis" aria-labelledby="ai-aside-title" data-testid="ai-suggestion-aside">
      <div className="ai-analysis-header">
        <h2 id="ai-aside-title" className="text-lg font-semibold">{t(locale, "ai.aside.title")}</h2>
        <Badge>{t(locale, "ai.label")}</Badge>
      </div>
      <p className="field-help">{t(locale, "ai.aside.help")}</p>
      {reasonKey ? <p className="field-help" role="status">{t(locale, reasonKey)}</p> : null}
      <dl className="ai-analysis-fields">
        {rows.filter((row): row is [MessageKey, string] => row[1] !== null).map(([key, value]) => (
          <div key={key} className="ai-analysis-field">
            <dt className="field-label">{t(locale, key)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
