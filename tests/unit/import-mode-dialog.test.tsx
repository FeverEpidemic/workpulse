import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import { ImportModeDialog } from "@/features/import/import-mode-dialog";
import { t, type MessageKey } from "@/i18n/messages";

function render(locale: "en" | "id" = "en", extra: Partial<Parameters<typeof ImportModeDialog>[0]> = {}) {
  return renderToStaticMarkup(
    <ImportModeDialog
      open locale={locale} step="choose" granted={false} pending={null} error=""
      onCancel={vi.fn()} onChoose={vi.fn()} onBack={vi.fn()} onConfirmRules={vi.fn()} {...extra}
    />,
  );
}

const T26_KEYS: MessageKey[] = [
  "import.mode.title", "import.mode.description", "import.mode.aiTitle", "import.mode.aiBody", "import.mode.aiConsent",
  "import.mode.aiAction", "import.mode.rulesTitle", "import.mode.rulesBody", "import.mode.rulesAction", "import.mode.shared",
  "import.rulesNote", "import.emptyBodyRules", "import.failed.IMPORT_RULES_FAILED",
];

const T28_KEYS: MessageKey[] = [
  "import.disclosureChoice", "import.mode.rulesAiOff", "import.mode.confirmTitle", "import.mode.confirmBody",
  "import.mode.confirmAction", "import.mode.confirmBack",
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Saving…<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Read without AI<\/button>/);
  });

  it("keeps the AI card honest when the AI import limit is reached", () => {
    const html = render("en", { aiNotice: <p>Limit reached</p> });
    expect(html).toContain("Limit reached");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Use AI<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Read without AI<\/button>/);
  });
});

describe("T28 import mode dialog: every upload, and a confirmation before AI is turned off", () => {
  const aiOff = "This also turns off AI for activity analysis. You can turn it back on in Settings.";

  it("tells a user with consent that Read without AI turns AI off, and says nothing of it without consent", () => {
    const withConsent = render("en", { granted: true });
    expect(withConsent).toContain(aiOff);
    expect(withConsent.indexOf("Without AI")).toBeLessThan(withConsent.indexOf(aiOff));
    expect(withConsent.indexOf(aiOff)).toBeLessThan(withConsent.indexOf("Read without AI"));
    expect(render("en", { granted: false })).not.toContain(aiOff);
  });

  it("swaps the cards for a confirmation with a focusable heading and two equal buttons, Turn off first", () => {
    const html = render("en", { granted: true, step: "confirm" });
    expect(html).toMatch(/<h3 id="[^"]+" tabindex="-1"[^>]*>Turn off AI for your account\?<\/h3>/);
    expect(html).toContain("Your CV will be read without AI, and AI stops for activity analysis too. If an AI analysis is still running, its result is discarded. Your notes, drafts and achievements stay as they are. You can turn AI back on in Settings.");
    const choice = (label: string) => new RegExp(`<button[^>]*class="([^"]+)"[^>]*>${label}</button>`).exec(html)?.[1];
    expect(choice("Turn off AI and read CV")).toBe("button-secondary");
    expect(choice("Back")).toBe("button-secondary");
    expect(html.indexOf("Turn off AI and read CV")).toBeLessThan(html.indexOf(">Back<"));
    expect(html).not.toContain("button-primary");
    expect(html).not.toContain("Use AI");
    expect(html).not.toContain(t("en", "import.mode.shared"));
    expect(html).toContain("How should we read your CV?");
  });

  it("shows a withdraw error in the confirmation and a busy state on the confirm button only", () => {
    const html = render("en", { granted: true, step: "confirm", pending: "rules", error: "Reload to see the latest settings." });
    expect(html).toMatch(/<p role="alert"[^>]*>Reload to see the latest settings\.<\/p>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Saving…<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Back<\/button>/);
  });

  // T28 review RV1: once a choice runs, closing the dialog would leave consent changed and nothing uploaded.
  it("disables Cancel while a choice is being saved or uploaded, in both views", () => {
    const cancel = /<button[^>]*>Cancel<\/button>/;
    expect(render("en", { granted: true, step: "confirm", pending: "rules" }).match(cancel)?.[0]).toContain('disabled=""');
    expect(render("en", { pending: "ai" }).match(cancel)?.[0]).toContain('disabled=""');
    expect(render("en", { granted: true, step: "confirm" }).match(cancel)?.[0]).not.toContain("disabled");
    expect(render().match(cancel)?.[0]).not.toContain("disabled");
  });

  it("has the approved Indonesian confirmation", () => {
    const html = render("id", { granted: true, step: "confirm" });
    for (const text of ["Matikan AI untuk akun Anda?", "Matikan AI dan baca CV", "Kembali",
      "Kalau ada analisis AI yang masih berjalan, hasilnya dibuang."]) {
      expect(html).toContain(text);
    }
    expect(render("id", { granted: true })).toContain("Pilihan ini juga mematikan AI untuk analisis aktivitas.");
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

describe("T26 and T28 copy", () => {
  it("has every new key in en and id, without em dashes", () => {
    for (const key of [...T26_KEYS, ...T28_KEYS]) {
      for (const locale of ["en", "id"] as const) {
        const text = t(locale, key);
        expect(text, `${locale} ${key}`).not.toBe(key);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toContain("—");
      }
    }
    expect(t("en", "import.mode.aiAction")).toBe("Use AI");
    expect(t("id", "import.rulesNote")).toBe("Data ini dibaca tanpa AI. Cek nama perusahaan, jabatan, dan tanggal sebelum mengonfirmasi.");
    expect(t("en", "import.disclosureChoice")).toBe("With AI, your CV text is sent to an external AI provider. Without AI, WorkPulse reads it itself using fixed rules. The file, its name and your other records are never sent.");
    expect(t("id", "import.disclosureChoice")).toBe("Dengan AI, teks CV dikirim ke penyedia AI eksternal. Tanpa AI, WorkPulse membacanya sendiri dengan aturan tetap. File, nama file, dan data Anda yang lain tidak pernah dikirim.");
  });

  // T28 replaced the consent-dependent S02 disclosure with one text for everyone.
  it("no longer refers to the removed disclosure keys anywhere in src", () => {
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
      });
    })(join(process.cwd(), "src"));
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/"import\.disclosure(NoConsent)?"/);
    }
  });
});
