import { ArrowDown, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ActivityListRow } from "@/features/activity/activity-list";
import { ExampleFrame } from "@/features/marketing/example-frame";
import type { LandingSample } from "@/features/marketing/sample-data";
import { t, type Locale } from "@/i18n/messages";

/** Hero sample: an Activity note and the Achievement suggested from it, in its final (approved) state. */
export function HeroStory({ sample, locale }: { sample: LandingSample["hero"]; locale: Locale }) {
  return (
    <ExampleFrame label={t(locale, "landing.hero.exampleLabel")} locale={locale} className="landing-hero-example">
      <div className="landing-hero-stack">
        <div className="landing-card landing-hero-activity">
          <ActivityListRow activity={sample.activity} options={sample.activityOptions} locale={locale} />
          <p className="landing-card-foot">{sample.savedAsWritten}</p>
        </div>
        <p className="landing-connector">
          <ArrowDown aria-hidden="true" size={14} strokeWidth={2} />
          {sample.connector}
        </p>
        <div className="landing-card landing-hero-achievement">
          <span className="landing-badges">
            <Badge className="landing-badge-info">{sample.aiBadge}</Badge>
            <Badge variant="success"><Check aria-hidden="true" size={12} strokeWidth={2.5} /> {sample.approved}</Badge>
          </span>
          <p className="landing-card-title">{sample.title}</p>
          <p className="landing-card-text">{sample.contribution}</p>
        </div>
      </div>
    </ExampleFrame>
  );
}
