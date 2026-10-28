"use client";

import { ArrowDown, Check, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useReducer, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ActivityListRow } from "@/features/activity/activity-list";
import { ExampleFrame } from "@/features/marketing/example-frame";
import { initialStoryState, storyNextStep, storyReducer } from "@/features/marketing/hero-story-state";
import type { LandingSample } from "@/features/marketing/sample-data";
import { t, type Locale } from "@/i18n/messages";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hero sample: an Activity note is typed and saved, AI suggests an Achievement, and it is approved. The server
 * renders the end; after hydration the story plays once from the start, with a replay button at the end.
 */
export function HeroStory({ sample, locale }: { sample: LandingSample["hero"]; locale: Locale }) {
  const characters = Array.from(sample.note);
  const [state, dispatch] = useReducer(storyReducer, characters.length, initialStoryState);
  const [canReplay, setCanReplay] = useState(false);

  // Before paint, so the end state from the server is never shown and then taken back.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (prefersReducedMotion() || root.dataset.heroStory === "expired") return;
    root.dataset.heroStory = "running";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- replaying is the point of mounting before paint
    setCanReplay(true);
    dispatch({ type: "replay" });
  }, []);

  useEffect(() => {
    const step = storyNextStep(state);
    if (!step) return;
    const timer = window.setTimeout(() => dispatch(step.event), step.delay);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const finish = () => { if (document.hidden) dispatch({ type: "finish" }); };
    document.addEventListener("visibilitychange", finish);
    return () => document.removeEventListener("visibilitychange", finish);
  }, []);

  const running = state.phase !== "done";
  const saved = !["idle", "typing"].includes(state.phase);
  const suggested = ["suggested", "approved", "done"].includes(state.phase);
  const approved = ["approved", "done"].includes(state.phase);
  const activity = { ...sample.activity, raw_text: characters.slice(0, state.typed).join("") };

  return (
    <div className="landing-hero-example">
      <ExampleFrame label={t(locale, "landing.hero.exampleLabel")} locale={locale}>
        <div className="landing-hero-stack" data-phase={state.phase} data-saved={String(saved)} data-suggested={String(suggested)}>
          <div className="landing-card landing-hero-activity">
            <ActivityListRow activity={activity} options={sample.activityOptions} locale={locale} />
            <p className="landing-card-foot">{sample.savedAsWritten}</p>
          </div>
          <p className="landing-connector">
            <ArrowDown aria-hidden="true" size={14} strokeWidth={2} />
            {sample.connector}
          </p>
          <div className="landing-card landing-hero-achievement">
            <span className="landing-badges">
              <Badge className="landing-badge-info">{sample.aiBadge}</Badge>
              {approved
                ? <Badge variant="success"><Check aria-hidden="true" size={12} strokeWidth={2.5} /> {sample.approved}</Badge>
                : <Badge>{sample.reviewBadge}</Badge>}
            </span>
            <p className="landing-card-title">{sample.title}</p>
            <p className="landing-card-text">{sample.contribution}</p>
          </div>
        </div>
      </ExampleFrame>
      {canReplay ? (
        <button
          type="button"
          className="button-secondary landing-replay"
          aria-disabled={running}
          onClick={() => { if (!running) dispatch({ type: "replay" }); }}
        >
          <RotateCcw aria-hidden="true" size={16} strokeWidth={1.8} />
          {t(locale, "landing.hero.replay")}
        </button>
      ) : null}
    </div>
  );
}
