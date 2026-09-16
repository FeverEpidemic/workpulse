export type DatePrecision = "unknown" | "year" | "month" | "day";
export type CanonicalDatePrecision = Exclude<DatePrecision, "unknown">;

export interface PartialDateInput {
  precision: DatePrecision;
  year?: string | number | null;
  month?: string | number | null;
  day?: string | number | null;
}

export interface CanonicalPartialDate {
  date: string | null;
  precision: CanonicalDatePrecision | null;
}

export class PartialDateValidationError extends Error {
  constructor(
    readonly field: "year" | "month" | "day",
    readonly inputName: string | null = null,
  ) {
    super(`Invalid ${field}`);
    this.name = "PartialDateValidationError";
  }
}

function parseInteger(value: string | number | null | undefined, field: "year" | "month" | "day"): number {
  if (value === null || value === undefined || value === "") throw new PartialDateValidationError(field);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new PartialDateValidationError(field);
  return parsed;
}

function formatPart(value: number): string {
  return String(value).padStart(2, "0");
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Convert a user precision choice to the canonical date + precision pair stored in PostgreSQL. */
export function normalizePartialDate(input: PartialDateInput): CanonicalPartialDate {
  if (input.precision === "unknown") return { date: null, precision: null };

  const year = parseInteger(input.year, "year");
  if (year < 1 || year > 9999) throw new PartialDateValidationError("year");

  if (input.precision === "year") {
    return { date: `${String(year).padStart(4, "0")}-01-01`, precision: "year" };
  }

  const month = parseInteger(input.month, "month");
  if (month < 1 || month > 12) throw new PartialDateValidationError("month");

  if (input.precision === "month") {
    return { date: `${String(year).padStart(4, "0")}-${formatPart(month)}-01`, precision: "month" };
  }

  if (input.precision !== "day") throw new PartialDateValidationError("day");
  const day = parseInteger(input.day, "day");
  if (day < 1 || !isRealCalendarDate(year, month, day)) throw new PartialDateValidationError("day");
  return {
    date: `${String(year).padStart(4, "0")}-${formatPart(month)}-${formatPart(day)}`,
    precision: "day",
  };
}

export function parsePartialDateForm(form: FormData, prefix: string): CanonicalPartialDate {
  const rawPrecision = String(form.get(`${prefix}_precision`) ?? "unknown");
  if (!["unknown", "year", "month", "day"].includes(rawPrecision)) {
    throw new PartialDateValidationError("year", `${prefix}_precision`);
  }
  try {
    return normalizePartialDate({
      precision: rawPrecision as DatePrecision,
      year: String(form.get(`${prefix}_year`) ?? ""),
      month: String(form.get(`${prefix}_month`) ?? ""),
      day: String(form.get(`${prefix}_day`) ?? ""),
    });
  } catch (error) {
    if (error instanceof PartialDateValidationError) {
      throw new PartialDateValidationError(error.field, `${prefix}_${error.field}`);
    }
    throw error;
  }
}
