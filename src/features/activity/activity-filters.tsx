"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field-control";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { readActivityQuery, type ActivityFilterError, type ActivityFilters } from "@/domain/routes/url-filters";
import { activityFilterKeys } from "@/domain/routes/url-filters";
import { t, type Locale } from "@/i18n/messages";

function omitEmptyFilters(event: FormEvent<HTMLFormElement>) {
  for (const key of activityFilterKeys) {
    const control = event.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-activity-filter="${key}"]`);
    if (!control) continue;
    if (!control.value.trim()) control.removeAttribute("name");
    else control.setAttribute("name", key);
  }
}

function filterError(locale: Locale, error: ActivityFilterError | undefined): string | null {
  if (!error) return null;
  return t(locale, error === "range" ? "activity.invalidDateRange" : "activity.invalidDate");
}

export function ActivityFiltersForm({
  filters,
  errors,
  options,
  locale,
}: {
  filters: ActivityFilters;
  errors: Partial<Record<"from" | "to" | "project", ActivityFilterError>>;
  options: ActivityContextOptions;
  locale: Locale;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [formFilters, setFormFilters] = useState(filters);
  const { from: serverFrom, to: serverTo, project: serverProject } = filters;

  const syncControls = useCallback((values: ActivityFilters) => {
    const form = formRef.current;
    if (!form) return;
    for (const key of activityFilterKeys) {
      const control = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-activity-filter="${key}"]`);
      if (!control) continue;
      control.value = values[key];
      control.setAttribute("name", key);
    }
  }, []);

  useLayoutEffect(() => {
    syncControls({ from: serverFrom, to: serverTo, project: serverProject });
  }, [serverFrom, serverProject, serverTo, syncControls]);

  useEffect(() => {
    function syncFiltersFromAddressBar() {
      const nextFilters = readActivityQuery(window.location.search).filters;
      setFormFilters(nextFilters);
      syncControls(nextFilters);
    }
    function scheduleAddressBarSync() {
      window.requestAnimationFrame(syncFiltersFromAddressBar);
    }

    window.addEventListener("popstate", scheduleAddressBarSync);
    window.addEventListener("pageshow", scheduleAddressBarSync);
    return () => {
      window.removeEventListener("popstate", scheduleAddressBarSync);
      window.removeEventListener("pageshow", scheduleAddressBarSync);
    };
  }, [syncControls]);

  function updateFilter(key: keyof ActivityFilters, event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const value = event.currentTarget.value;
    setFormFilters((current) => ({ ...current, [key]: value }));
  }

  const fromError = filterError(locale, errors.from);
  const toError = filterError(locale, errors.to);
  const projectError = errors.project ? t(locale, "activity.invalidProject") : null;
  const selectedProjectExists = options.projects.some((project) => project.id === filters.project);

  return (
    <form
      ref={formRef}
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
          data-activity-filter="from"
          type="date"
          value={formFilters.from}
          onChange={(event) => updateFilter("from", event)}
          aria-invalid={fromError ? true : undefined}
          aria-describedby={fromError ? "activity-filter-from-error" : undefined}
        />
        {fromError ? <span id="activity-filter-from-error" className="field-error">{fromError}</span> : null}
      </label>
      <label className="field-label" htmlFor="activity-filter-to">
        {t(locale, "activity.to")}
        <Input
          className="mt-1"
          id="activity-filter-to"
          name="to"
          data-activity-filter="to"
          type="date"
          value={formFilters.to}
          onChange={(event) => updateFilter("to", event)}
          aria-invalid={toError ? true : undefined}
          aria-describedby={toError ? "activity-filter-to-error" : undefined}
        />
        {toError ? <span id="activity-filter-to-error" className="field-error">{toError}</span> : null}
      </label>
      <label className="field-label workspace-project-filter" htmlFor="activity-filter-project">
        {t(locale, "activity.project")}
        <Select
          className="mt-1"
          id="activity-filter-project"
          name="project"
          data-activity-filter="project"
          value={formFilters.project}
          onChange={(event) => updateFilter("project", event)}
          aria-invalid={projectError ? true : undefined}
          aria-describedby={projectError ? "activity-filter-project-error" : undefined}
        >
          <option value="">{t(locale, "activity.projectPlaceholder")}</option>
          {filters.project && !selectedProjectExists ? (
            <option value={filters.project}>{t(locale, "activity.projectUnavailable")}</option>
          ) : null}
          {options.projects.map((project) => (
            <option key={project.id} value={project.id}>{project.title}</option>
          ))}
        </Select>
        {projectError ? <span id="activity-filter-project-error" className="field-error">{projectError}</span> : null}
      </label>
      <div className="workspace-filter-actions">
        <Button type="submit" variant="secondary">{t(locale, "activity.applyFilters")}</Button>
        <Link className="button-secondary" href="/activity">{t(locale, "activity.clearFilters")}</Link>
      </div>
    </form>
  );
}
