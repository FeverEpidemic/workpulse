"use client";

import Link from "next/link";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field-control";
import { t, type Locale } from "@/i18n/messages";
import type { ActivityFilters } from "@/domain/routes/url-filters";
import { activityFilterKeys } from "@/domain/routes/url-filters";

function omitEmptyFilters(event: FormEvent<HTMLFormElement>) {
  for (const key of activityFilterKeys) {
    const control = event.currentTarget.elements.namedItem(key);
    if (control instanceof HTMLInputElement && !control.value.trim()) {
      control.removeAttribute("name");
    }
  }
}

export function ActivityFiltersForm({
  filters,
  locale,
}: {
  filters: ActivityFilters;
  locale: Locale;
}) {
  return (
    <form
      method="get"
      action="/activity"
      onSubmit={omitEmptyFilters}
      className="workspace-filter-form"
      aria-labelledby="activity-filters-title"
    >
      <h2 id="activity-filters-title" className="sr-only">{t(locale, "activity.filters")}</h2>
      <label className="field-label" htmlFor="activity-filter-from">
        {t(locale, "activity.from")}
        <Input
          className="mt-1"
          id="activity-filter-from"
          name="from"
          type="date"
          defaultValue={filters.from}
        />
      </label>
      <label className="field-label" htmlFor="activity-filter-to">
        {t(locale, "activity.to")}
        <Input
          className="mt-1"
          id="activity-filter-to"
          name="to"
          type="date"
          defaultValue={filters.to}
        />
      </label>
      <label className="field-label workspace-project-filter" htmlFor="activity-filter-project">
        {t(locale, "activity.project")}
        <Input
          className="mt-1"
          id="activity-filter-project"
          name="project"
          type="search"
          maxLength={120}
          placeholder={t(locale, "activity.projectPlaceholder")}
          defaultValue={filters.project}
        />
      </label>
      <div className="workspace-filter-actions">
        <Button type="submit" variant="secondary">{t(locale, "activity.applyFilters")}</Button>
        <Link className="button-secondary" href="/activity">{t(locale, "activity.clearFilters")}</Link>
      </div>
    </form>
  );
}
