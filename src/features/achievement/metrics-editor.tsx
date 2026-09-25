"use client";

import { useRef, useState } from "react";

import { Input } from "@/components/ui/field-control";
import type { AchievementMetric } from "@/domain/achievement/contracts";
import type { Locale } from "@/i18n/messages";
import { t } from "@/i18n/messages";

type MetricDraft = {
  key: string;
  label: string;
  value: string;
  unit: string;
  baseline: string;
  period: string;
};

function toDraft(metric: AchievementMetric, index: number): MetricDraft {
  return {
    key: `initial-${index}`,
    label: metric.label,
    value: String(metric.value),
    unit: metric.unit,
    baseline: metric.baseline === undefined ? "" : String(metric.baseline),
    period: metric.period ?? "",
  };
}

export function MetricsEditor({ locale, initialValue }: { locale: Locale; initialValue: AchievementMetric[] }) {
  const [rows, setRows] = useState<MetricDraft[]>(() => initialValue.map(toDraft));
  const nextKey = useRef(initialValue.length);

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <fieldset key={row.key} className="rounded-lg border border-[var(--color-border)] p-3">
          <legend className="sr-only">{t(locale, "achievement.metrics")} {index + 1}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="field-label">{t(locale, "achievement.metricLabel")}<Input name={`metric_${index}_label`} defaultValue={row.label} maxLength={100} /></label>
            <label className="field-label">{t(locale, "achievement.metricValue")}<Input name={`metric_${index}_value`} defaultValue={row.value} inputMode="decimal" /></label>
            <label className="field-label">{t(locale, "achievement.metricUnit")}<Input name={`metric_${index}_unit`} defaultValue={row.unit} maxLength={50} /></label>
            <label className="field-label">{t(locale, "achievement.metricBaseline")}<Input name={`metric_${index}_baseline`} defaultValue={row.baseline} inputMode="decimal" /></label>
            <label className="field-label sm:col-span-2">{t(locale, "achievement.metricPeriod")}<Input name={`metric_${index}_period`} defaultValue={row.period} maxLength={100} /></label>
          </div>
          <button type="button" className="button-secondary mt-3" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t(locale, "achievement.removeMetric")}</button>
        </fieldset>
      ))}
      <button type="button" className="button-secondary" onClick={() => setRows((current) => [...current, { key: `added-${nextKey.current++}`, label: "", value: "", unit: "", baseline: "", period: "" }])} disabled={rows.length >= 20}>{t(locale, "achievement.addMetric")}</button>
    </div>
  );
}
