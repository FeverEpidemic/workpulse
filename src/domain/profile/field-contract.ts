/** Shared field limits for profile and foundation forms and their server schemas. */
export const PROFILE_FIELD_LIMITS = {
  displayName: 80,
  headline: 120,
  summary: 2_000,
  contactEmail: 320,
  phone: 40,
  location: 120,
  website: 2_048,
  timezone: 100,
} as const;

export const FOUNDATION_FIELD_LIMITS = {
  organization: 200,
  roleTitle: 200,
  experienceDescription: 5_000,
  institution: 200,
  qualification: 200,
  fieldOfStudy: 200,
  educationDescription: 5_000,
  certificationName: 200,
  issuer: 200,
  credentialUrl: 2_048,
  skillName: 100,
} as const;

export const AUTH_FIELD_LIMITS = {
  email: PROFILE_FIELD_LIMITS.contactEmail,
  password: 128,
} as const;
