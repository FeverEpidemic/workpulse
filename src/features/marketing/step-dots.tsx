import { t, type Locale, type MessageKey } from "@/i18n/messages";

const STEP_KEYS: MessageKey[] = ["landing.steps.1", "landing.steps.2", "landing.steps.3", "landing.steps.4", "landing.steps.5"];

/** Five dots for the five steps of the flow. Not the logo: no blank dot, and the active range is also given as text. */
export function StepDots({ from, to, locale }: { from: number; to: number; locale: Locale }) {
  const status = from === to ? t(locale, "landing.steps.statusOne", { step: to }) : t(locale, "landing.steps.status", { from, to });
  return (
    <div className="landing-steps">
      <ol className="landing-step-list" aria-hidden="true">
        {STEP_KEYS.map((key, index) => (
          <li key={key} className="landing-step" data-on={index + 1 >= from && index + 1 <= to ? "true" : "false"}>
            <span className="landing-step-dot" />
            <span className="landing-step-label">{t(locale, key)}</span>
          </li>
        ))}
      </ol>
      <p className="landing-step-status">{status}</p>
    </div>
  );
}
