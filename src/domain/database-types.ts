import type { Locale } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";

export type LocaleCode = Locale;
export type DatePrecisionCode = "year" | "month" | "day";
export type ExperienceKind = "employment" | "internship" | "volunteer";
export type ProjectStatus = "planned" | "active" | "completed";

type ProfileDatabaseRow = Database["public"]["Tables"]["profiles"]["Row"];
type ExperienceDatabaseRow = Database["public"]["Tables"]["experiences"]["Row"];
type EducationDatabaseRow = Database["public"]["Tables"]["education"]["Row"];
type CertificationDatabaseRow = Database["public"]["Tables"]["certifications"]["Row"];
type ProjectDatabaseRow = Database["public"]["Tables"]["projects"]["Row"];

// PostgreSQL CHECK constraints keep these text columns within the narrower
// application domain even though Supabase's generated schema types use string.
export type ProfileRow = Omit<ProfileDatabaseRow, "locale"> & { locale: Locale };
export type ExperienceRow = Omit<ExperienceDatabaseRow, "kind" | "start_precision" | "end_precision"> & {
  kind: ExperienceKind;
  start_precision: DatePrecisionCode | null;
  end_precision: DatePrecisionCode | null;
};
export type EducationRow = Omit<EducationDatabaseRow, "start_precision" | "end_precision"> & {
  start_precision: DatePrecisionCode | null;
  end_precision: DatePrecisionCode | null;
};
export type CertificationRow = Omit<CertificationDatabaseRow, "issued_precision"> & {
  issued_precision: DatePrecisionCode | null;
};
export type ProjectRow = Omit<ProjectDatabaseRow, "status" | "start_precision" | "end_precision"> & {
  status: ProjectStatus;
  start_precision: DatePrecisionCode | null;
  end_precision: DatePrecisionCode | null;
};
export type SkillRow = Database["public"]["Tables"]["skills"]["Row"];
