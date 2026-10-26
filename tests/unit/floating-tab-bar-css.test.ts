import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

// Body of the block that opens at `header` and closes at its matching brace.
function blocksAt(source: string, header: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(header, from);
    if (start === -1) return bodies;
    let depth = 0;
    let cursor = start + header.length - 1;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(start + header.length, cursor));
    from = cursor;
  }
}

function rule(source: string, selector: string): string {
  const matches = blocksAt(source, `${selector} {`);
  expect(matches.length, `${selector} rule`).toBeGreaterThan(0);
  return matches.join("\n");
}

const mobile = blocksAt(css, "@media (max-width: 880px) {");
const mobileCss = mobile.join("\n");

describe("T31 floating tab bar", () => {
  it("makes the nav itself a centred capsule, not a full-width wrapper", () => {
    const bar = rule(mobileCss, ".workspace-tab-bar");
    expect(bar).toMatch(/position:\s*fixed/);
    expect(bar).toMatch(/left:\s*50%/);
    expect(bar).toMatch(/bottom:\s*var\(--tab-bar-offset\)/);
    expect(bar).toMatch(/width:\s*var\(--tab-bar-width\)/);
    expect(bar).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(bar).not.toMatch(/(?:^|[\s;])(?:right|border-top|padding-bottom)\s*:/);
  });

  it("gives the capsule a border on every side, the lg radius and one medium shadow, without blur", () => {
    const bar = rule(mobileCss, ".workspace-tab-bar");
    expect(bar).toMatch(/border:\s*1px solid var\(--color-border-default\)/);
    expect(bar).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(bar).toMatch(/box-shadow:\s*var\(--shadow-md\)/);
    expect(bar).toMatch(/background:\s*var\(--color-bg-surface\)/);
    // The dialog backdrop blurs; the bar must not (decision 0035 #7).
    expect(bar).not.toMatch(/backdrop-filter/);
    expect(rule(css, ".workspace-tab-list")).not.toMatch(/backdrop-filter/);
  });

  it("keeps 8 px from the edges plus the bottom safe area, and caps the expanded width at 480 px", () => {
    // 8 px, not 12: a 336 px capsule leaves the bold "Dashboard" label 1.3 px short (T31 phase 0).
    expect(mobileCss).toMatch(/--tab-bar-gutter:\s*var\(--space-2\)/);
    expect(mobileCss).toMatch(/--tab-bar-offset:\s*calc\(var\(--tab-bar-gutter\) \+ env\(safe-area-inset-bottom\)\)/);
    expect(mobileCss).toMatch(/--tab-bar-width:\s*min\(calc\(100% - 2 \* var\(--tab-bar-gutter\)\), 480px\)/);
  });

  it("narrows to five targets with gaps when compact, and eases the width with the motion tokens", () => {
    expect(mobileCss).toMatch(/--tab-bar-compact-width:\s*calc\(5 \* var\(--touch-target-min\) \+ 6 \* var\(--space-2\)\)/);
    const compact = rule(mobileCss, '.workspace-tab-bar[data-compact="true"]');
    expect(compact).toMatch(/--tab-bar-width:\s*var\(--tab-bar-compact-width\)/);
    const bar = rule(mobileCss, ".workspace-tab-bar");
    expect(bar).toMatch(/transition:\s*width var\(--motion-normal\) var\(--ease-out\)/);
  });

  it("moves the slots with the capsule: height, gap and padding share one duration and easing", () => {
    const list = rule(css, ".workspace-tab-list");
    for (const property of ["height", "column-gap", "padding"]) {
      expect(list).toContain(`${property} var(--motion-normal) var(--ease-out)`);
    }
    const compact = rule(mobileCss, '.workspace-tab-bar[data-compact="true"] .workspace-tab-list');
    expect(compact).toMatch(/column-gap:\s*var\(--space-2\)/);
    expect(compact).toMatch(/padding:\s*0 calc\(var\(--space-2\) - 1px\)/);
  });

  it("gives the expanded list no side padding, so the bold Dashboard label has room (gate G1)", () => {
    expect(rule(css, ".workspace-tab-list")).toMatch(/(?:^|[\s;])padding:\s*0;/);
  });

  it("draws the dark capsule edge with the strong border, since the shadow barely shows (gate G3)", () => {
    expect(rule(mobileCss, '[data-theme="dark"] .workspace-tab-bar')).toMatch(/border-color:\s*var\(--color-border-strong\)/);
  });

  it("never animates the capsule's position or opacity", () => {
    const bar = rule(mobileCss, ".workspace-tab-bar");
    const transition = bar.match(/transition:[^;]+;/)?.[0] ?? "";
    expect(transition).not.toMatch(/transform|opacity|bottom|left/);
  });

  it("reserves the capsule offset in the page bottom padding and in the toast position", () => {
    expect(rule(mobileCss, ".workspace-content")).toMatch(/calc\(64px \+ var\(--tab-bar-offset\) \+ var\(--space-10\)\)/);
    expect(rule(mobileCss, ".ui-toast-region")).toMatch(/bottom:\s*calc\(64px \+ var\(--tab-bar-offset\) \+ var\(--space-3\)\)/);
  });
});
