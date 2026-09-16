import { describe, expect, it } from "vitest";

import { normalizePartialDate, parsePartialDateForm, PartialDateValidationError } from "@/domain/dates/partial-date";

describe("canonical partial dates", () => {
  it("stores an unknown date as two nulls", () => {
    expect(normalizePartialDate({ precision: "unknown", year: "", month: "", day: "" })).toEqual({
      date: null,
      precision: null,
    });
  });

  it("normalizes year and month precision to the first calendar day", () => {
    expect(normalizePartialDate({ precision: "year", year: "2020" })).toEqual({
      date: "2020-01-01",
      precision: "year",
    });
    expect(normalizePartialDate({ precision: "month", year: "2020", month: "9" })).toEqual({
      date: "2020-09-01",
      precision: "month",
    });
  });

  it("validates full dates including leap years", () => {
    expect(normalizePartialDate({ precision: "day", year: "2024", month: "2", day: "29" })).toEqual({
      date: "2024-02-29",
      precision: "day",
    });
    expect(() => normalizePartialDate({ precision: "day", year: "2023", month: "2", day: "29" })).toThrow(
      new PartialDateValidationError("day"),
    );
  });

  it("reads the same canonical input shape from a form", () => {
    const form = new FormData();
    form.set("start_precision", "month");
    form.set("start_year", "2022");
    form.set("start_month", "4");
    expect(parsePartialDateForm(form, "start")).toEqual({ date: "2022-04-01", precision: "month" });
  });

  it("reports an invalid partial-date component against its own form control", () => {
    const form = new FormData();
    form.set("end_precision", "day");
    form.set("end_year", "2023");
    form.set("end_month", "2");
    form.set("end_day", "29");

    try {
      parsePartialDateForm(form, "end");
      throw new Error("Expected the invalid date to fail validation");
    } catch (error) {
      expect(error).toMatchObject({ field: "day", inputName: "end_day" });
    }
  });
});
