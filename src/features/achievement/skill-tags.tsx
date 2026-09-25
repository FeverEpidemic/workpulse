"use client";

import { useState } from "react";

import { Input } from "@/components/ui/field-control";
import type { Locale } from "@/i18n/messages";
import { t } from "@/i18n/messages";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function SkillTags({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [duplicate, setDuplicate] = useState(false);

  function add(raw: string): boolean {
    const name = raw.trim();
    if (!name) return false;
    if (value.some((item) => normalize(item) === normalize(name))) {
      setDuplicate(true);
      return false;
    }
    setDuplicate(false);
    onChange([...value, name]);
    return true;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" aria-live="polite">
        {value.map((name) => (
          <span key={normalize(name)} className="ui-badge inline-flex items-center gap-2">
            {name}
            <button type="button" className="font-semibold" onClick={() => onChange(value.filter((item) => item !== name))} aria-label={t(locale, "achievement.removeSkill", { name })}>×</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          data-skill-input="true"
          defaultValue=""
          onChange={() => setDuplicate(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              if (add(event.currentTarget.value)) event.currentTarget.value = "";
            }
          }}
          placeholder={t(locale, "achievement.skillPlaceholder")}
          aria-label={t(locale, "achievement.skillPlaceholder")}
          maxLength={100}
        />
        <button type="button" className="button-secondary" onClick={(event) => {
          const input = event.currentTarget.form?.querySelector<HTMLInputElement>('input[data-skill-input="true"]');
          if (input && add(input.value)) input.value = "";
        }}>{t(locale, "achievement.addSkill")}</button>
      </div>
      {duplicate ? <p className="field-error" role="status">{t(locale, "validation.skillDuplicate")}</p> : null}
      <input type="hidden" name="skill_names" value={JSON.stringify(value)} readOnly />
    </div>
  );
}
