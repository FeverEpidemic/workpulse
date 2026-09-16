import * as z from "zod";

const trimmedOptional = (max: number) =>
  z.string().trim().max(max).transform((value) => (value === "" ? null : value));

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "validation.displayName")
  .max(80)
  .refine((value) => value.toLowerCase() !== "pending onboarding", "validation.displayName");

export const localeSchema = z.enum(["en", "id"]);

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "validation.timezone")
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "validation.timezone");

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => (value === "" ? null : value))
  .refine((value) => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "validation.url");

export const profileFormSchema = z.object({
  display_name: displayNameSchema,
  headline: trimmedOptional(120),
  summary: trimmedOptional(2000),
  contact_email: z
    .string()
    .trim()
    .max(320)
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || z.email().safeParse(value).success, "validation.email"),
  phone: trimmedOptional(40),
  location: trimmedOptional(120),
  website: optionalUrl,
  locale: localeSchema,
  timezone: timezoneSchema,
  expected_revision: z.coerce.number().int().positive(),
});

export const onboardingFormSchema = z.object({
  display_name: displayNameSchema,
  locale: localeSchema,
  timezone: timezoneSchema,
  expected_revision: z.coerce.number().int().positive(),
});

export const emailSchema = z
  .string()
  .trim()
  .max(320)
  .refine((value) => z.email().safeParse(value).success, "validation.email");
export const passwordSchema = z.string().min(8, "validation.passwordMin").max(128);

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
export type OnboardingFormValues = z.infer<typeof onboardingFormSchema>;
