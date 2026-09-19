const exactDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isExactActivityDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = exactDatePattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day <= daysInMonth;
}

/** Return the calendar date of an instant in the profile's validated IANA timezone. */
export function activityDateInTimeZone(instant: Date, profileTimezone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new RangeError("A valid instant is required");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: profileTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RangeError("Timezone date could not be resolved");

  return `${year.padStart(4, "0")}-${month}-${day}`;
}
