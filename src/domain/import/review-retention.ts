export const ABANDONED_REVIEW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a review batch is cancelled automatically, or null when the activity time is unreadable. */
export function abandonedReviewDeadline(lastActivityAt: string | Date | null | undefined): Date | null {
  if (lastActivityAt === null || lastActivityAt === undefined) return null;
  const time = lastActivityAt instanceof Date ? lastActivityAt.getTime() : Date.parse(lastActivityAt);
  if (Number.isNaN(time)) return null;
  return new Date(time + ABANDONED_REVIEW_DAYS * DAY_MS);
}

/** The day shown in the notice. UTC keeps the server and the browser render identical. */
export function formatAbandonedReviewDate(deadline: Date, locale: "en" | "id"): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(deadline);
}
