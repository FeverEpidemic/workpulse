import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

const wcagAaTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

export async function expectNoWcagViolations(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(wcagAaTags).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  expect(results.violations, `${label} WCAG A/AA Axe violations`).toEqual([]);
}

export async function expectEveryFieldErrorAssociated(page: Page): Promise<void> {
  const errors = await page.locator(".field-error").evaluateAll((elements) => elements.map((element) => {
    const id = element.id;
    const controls = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((control) => {
        const describedBy = control.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
        return describedBy.includes(id) || control.getAttribute("aria-errormessage") === id;
      });
    return {
      id,
      text: element.textContent?.trim() ?? "",
      duplicateCount: id ? document.querySelectorAll(`[id="${id}"]`).length : 0,
      controls: controls.map((control) => ({
        name: control.getAttribute("name"),
        invalid: control.getAttribute("aria-invalid"),
        labelText: Array.from((control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).labels ?? [])
          .map((label) => label.textContent?.trim() ?? "")
          .join(" "),
      })),
    };
  }));

  expect(errors.length, "the error state should render at least one field error").toBeGreaterThan(0);
  for (const error of errors) {
    expect(error.id, `field error ${error.text} needs a stable id`).not.toBe("");
    expect(error.duplicateCount, `field error id ${error.id} should exist exactly once`).toBe(1);
    expect(error.controls, `field error ${error.text} should be referenced by one control`).toHaveLength(1);
    expect(error.controls[0]?.invalid, `control ${error.controls[0]?.name} should be marked invalid`).toBe("true");
    expect(error.controls[0]?.labelText, `field error ${error.text} must not become part of the accessible name`).not.toContain(error.text);
  }
}
