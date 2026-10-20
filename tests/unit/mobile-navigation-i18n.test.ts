import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { t, type MessageKey } from "@/i18n/messages";

const T27_COPY: [MessageKey, string, string][] = [
  ["workspace.tabBar", "Main tabs", "Tab utama"],
  ["workspace.moreMenu", "More", "Menu lainnya"],
  ["workspace.openMoreMenu", "Open more menu", "Buka menu lainnya"],
  ["workspace.closeMoreMenu", "Close more menu", "Tutup menu lainnya"],
  ["workspace.moreMenuDescription", "Other sections of your workspace, theme and sign out.", "Bagian lain ruang kerja Anda, tema, dan keluar."],
  ["workspace.profileTab", "Profile", "Profil"],
  ["workspace.quickLog", "Quick log", "Catatan cepat"],
  ["quickLog.closeSheet", "Close quick log", "Tutup catatan cepat"],
  ["quickLog.openFullForm", "Open full form", "Detail lengkap"],
  [
    "quickLog.sheetDescription",
    "Write what you worked on. Add a project or more detail in the full form.",
    "Tulis apa yang Anda kerjakan. Tambahkan proyek atau detail lain di form lengkap.",
  ],
];

const REMOVED_DRAWER_KEYS = ["workspace.openMenu", "workspace.closeMenu", "workspace.mobileNavigationDescription"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("T27 mobile navigation copy", () => {
  it.each(T27_COPY)("%s has the approved English and Indonesian text", (key, en, id) => {
    expect(t("en", key)).toBe(en);
    expect(t("id", key)).toBe(id);
  });

  it("uses no em dash in the new copy", () => {
    for (const [key] of T27_COPY) {
      expect(t("en", key)).not.toContain("—");
      expect(t("id", key)).not.toContain("—");
    }
  });

  it("keeps the visible More label inside the button's accessible name", () => {
    for (const locale of ["en", "id"] as const) {
      expect(t(locale, "workspace.openMoreMenu").toLowerCase()).toContain(t(locale, "workspace.moreMenu").toLowerCase());
    }
  });

  it("drops the drawer copy and every reference to it", () => {
    const messages = readFileSync("src/i18n/messages.ts", "utf8");
    const sources = sourceFiles("src").map((path) => readFileSync(path, "utf8")).join("\n");
    for (const key of REMOVED_DRAWER_KEYS) {
      expect(messages).not.toContain(`"${key}"`);
      expect(sources).not.toContain(key);
    }
    expect(sources).not.toContain("workspace-drawer");
    expect(sources).not.toContain("workspace-quick-log--compact");
  });

  it("writes no literal user-facing strings in the new components", () => {
    for (const file of ["mobile-tab-bar.tsx", "mobile-header.tsx", "mobile-sheets.tsx", "mobile-chrome.tsx"]) {
      const source = readFileSync(join("src/components/layout", file), "utf8");
      expect(source, file).not.toMatch(/(aria-label|title|description|label)="[A-Za-z]/);
      expect(source, file).not.toMatch(/>\s*[A-Z][a-z]+(\s[a-z]+)*\s*</);
    }
  });
});
