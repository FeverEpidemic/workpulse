import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import { ImportModeDialog } from "@/features/import/import-mode-dialog";
import { t, type MessageKey } from "@/i18n/messages";

function render(locale: "en" | "id" = "en", extra: Partial<Parameters<typeof ImportModeDialog>[0]> = {}) {
  return renderToStaticMarkup(
    <ImportModeDialog open locale={locale} pending={null} error="" onCancel={vi.fn()} onChoose={vi.fn()} {...extra} />,
  );
}

const T26_KEYS: MessageKey[] = [
  "import.mode.title", "import.mode.description", "import.mode.aiTitle", "import.mode.aiBody", "import.mode.aiConsent",
  "import.mode.aiAction", "import.mode.rulesTitle", "import.mode.rulesBody", "import.mode.rulesAction", "import.mode.shared",
  "import.disclosureNoConsent", "import.rulesNote", "import.emptyBodyRules", "import.failed.IMPORT_RULES_FAILED",
];

describe("T26 import mode dialog: a neutral choice", () => {
  it("puts the title first and makes it the initial focus target, not a choice", () => {
    const html = render();
    expect(html).toMatch(/<h2 id="[^"]+" tabindex="-1"[^>]*>How should we read your CV\?<\/h2>/);
    expect(html.indexOf("How should we read your CV?")).toBeLessThan(html.indexOf("<button"));
  });

  it("shows two labelled cards in a fixed order, With AI first", () => {
    const html = render();
    const sections = [...html.matchAll(/<section class="import-mode-option" aria-labelledby="([^"]+)">/g)];
    expect(sections).toHaveLength(2);
    for (const [, id] of sections) expect(html).toContain(`id="${id}"`);
    expect(html.indexOf("With AI")).toBeLessThan(html.indexOf("Without AI"));
    expect(html.indexOf("Use AI")).toBeLessThan(html.indexOf("Read without AI"));
  });

  it("gives both choices the same button variant and no recommendation badge", () => {
    const html = render();
    const choice = (label: string) => new RegExp(`<button[^>]*class="([^"]+)"[^>]*>${label}</button>`).exec(html)?.[1];
    expect(choice("Use AI")).toBe("button-secondary");
    expect(choice("Read without AI")).toBe("button-secondary");
    expect(html).not.toContain("button-primary");
    expect(html).not.toMatch(/recommended|disarankan|badge/i);
  });

  it("explains both paths symmetrically, says the AI permission also covers activity analysis, and offers cancel", () => {
    const html = render();
    expect(html).toContain("Your CV text is sent to an external AI provider. It finds experience, education, skills, certifications and achievements.");
    expect(html).toContain("This permission also covers activity analysis. You can withdraw it in Settings.");
    expect(html).toContain("Your CV text is read on the WorkPulse server using fixed rules. It finds experience, education and skills. You usually get fewer results.");
    expect(html).toContain("Either way, the file, its name and your other records are not sent. You review every result before it is saved.");
    expect(html).toMatch(/<button[^>]*class="ui-button-ghost"[^>]*>Cancel<\/button>/);
  });

  it("has the approved Indonesian copy", () => {
    const html = render("id");
    for (const text of ["Bagaimana CV Anda dibaca?", "Dengan AI", "Tanpa AI", "Pakai AI", "Baca tanpa AI", "Batal",
      "Izin ini juga berlaku untuk analisis aktivitas dan bisa dicabut di Pengaturan."]) {
      expect(html).toContain(text);
    }
  });

  it("shows a save error inside the dialog and a busy state on the chosen button only", () => {
    const html = render("en", { pending: "ai", error: "Could not save." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not save.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>.*?Use AI<span class="sr-only">Saving…<\/span><\/button>/);
    expect(html).toContain("ui-loading-spinner");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Read without AI<\/button>/);
  });

  it("keeps the AI card honest when the AI import limit is reached", () => {
    const html = render("en", { aiNotice: <p>Limit reached</p> });
    expect(html).toContain("Limit reached");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Use AI<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Read without AI<\/button>/);
  });
});

describe("T26 Dialog primitive: focusTitle", () => {
  const dialog = (focusTitle?: boolean) => renderToStaticMarkup(
    <Dialog open onOpenChange={vi.fn()} title="Title" description="Body" focusTitle={focusTitle}><button type="button">Go</button></Dialog>,
  );

  it("makes the heading programmatically focusable only when asked", () => {
    expect(dialog(true)).toMatch(/<h2 id="[^"]+" tabindex="-1"/);
    expect(dialog()).not.toContain("tabindex");
    expect(dialog(false)).not.toContain("tabindex");
  });
});

describe("T26 copy", () => {
  it("has every new key in en and id, without em dashes", () => {
    for (const key of T26_KEYS) {
      for (const locale of ["en", "id"] as const) {
        const text = t(locale, key);
        expect(text, `${locale} ${key}`).not.toBe(key);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toContain("—");
      }
    }
    expect(t("en", "import.mode.aiAction")).toBe("Use AI");
    expect(t("id", "import.rulesNote")).toBe("Data ini dibaca tanpa AI. Cek nama perusahaan, jabatan, dan tanggal sebelum mengonfirmasi.");
  });
});
