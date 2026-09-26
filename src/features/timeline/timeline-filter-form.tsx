"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { TIMELINE_EVENT_TYPES, type TimelineEventType } from "@/domain/timeline/timeline";
import { timelineListHref, type TimelineFilters } from "@/domain/routes/timeline-filters";
import { t, type Locale } from "@/i18n/messages";

export function TimelineFilterForm({
  filters,
  projectOptions,
  clearVisible,
  locale,
}: {
  filters: TimelineFilters;
  projectOptions: { id: string; title: string }[];
  clearVisible: boolean;
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [type, setType] = useState<TimelineEventType | "">(filters.type);
  const [project, setProject] = useState(filters.project);

  useEffect(() => {
    const syncWithAddress = () => {
      const params = new URLSearchParams(window.location.search);
      const rawType = params.get("type") ?? "";
      setType(TIMELINE_EVENT_TYPES.includes(rawType as TimelineEventType) ? rawType as TimelineEventType : "");
      setProject(params.get("project") ?? "");
    };
    window.addEventListener("popstate", syncWithAddress);
    window.addEventListener("pageshow", syncWithAddress);
    return () => {
      window.removeEventListener("popstate", syncWithAddress);
      window.removeEventListener("pageshow", syncWithAddress);
    };
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = timelineListHref({ type, project });
    router.push(next, { scroll: false });
  }

  return (
    <form action="/timeline" method="get" onSubmit={applyFilters} className="timeline-filter-form">
      <label className="field-label" htmlFor="timeline-type-filter">
        {t(locale, "timeline.type")}
        <select id="timeline-type-filter" className="field-input mt-1" name="type" value={type} onChange={(event) => setType(event.currentTarget.value as TimelineEventType | "")}>
          <option value="">{t(locale, "timeline.allTypes")}</option>
          <option value="experience">{t(locale, "timeline.type.experience")}</option>
          <option value="education">{t(locale, "timeline.type.education")}</option>
          <option value="project">{t(locale, "timeline.type.project")}</option>
          <option value="achievement">{t(locale, "timeline.type.achievement")}</option>
        </select>
      </label>
      <label className="field-label" htmlFor="timeline-project-filter">
        {t(locale, "timeline.project")}
        <select id="timeline-project-filter" className="field-input mt-1" name="project" value={project} onChange={(event) => setProject(event.currentTarget.value)}>
          <option value="">{t(locale, "timeline.allProjects")}</option>
          {projectOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
        </select>
      </label>
      <button className="button-primary timeline-apply" type="submit">{t(locale, "timeline.apply")}</button>
      {clearVisible ? <Link className="button-secondary timeline-clear" href={timelineListHref({ type: "", project: "" })}>{t(locale, "timeline.clear")}</Link> : null}
    </form>
  );
}
