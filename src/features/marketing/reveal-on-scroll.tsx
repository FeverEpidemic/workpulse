"use client";

import { useEffect } from "react";

import { revealOffscreen } from "@/features/marketing/reveal-state";

/**
 * Two-way fade for `[data-reveal-item]`: an item fades out past either viewport edge and back in when it returns.
 * Items are only hidden under `html.is-reveal-ready`, which this adds after mount, so the page reads fully without
 * JavaScript or with reduced motion. Items on screen at mount never fade in.
 *
 * `data-reveal-settled` turns the stagger off once an item has left, so scrolling back does not lag.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const items = [...document.querySelectorAll<HTMLElement>("[data-reveal-item]")];
    let frame = 0;

    function update(settle: boolean) {
      frame = 0;
      const viewportHeight = window.innerHeight;
      for (const item of items) {
        const offscreen = revealOffscreen(item.getBoundingClientRect(), viewportHeight);
        const current = item.dataset.revealOffscreen ?? null;
        if (offscreen === current) continue;
        if (offscreen) {
          if (settle && !current) item.dataset.revealSettled = "";
          item.dataset.revealOffscreen = offscreen;
        } else {
          delete item.dataset.revealOffscreen;
        }
      }
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(() => update(true));
    }

    update(false);
    root.classList.add("is-reveal-ready");
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    // A demo tab of another height moves the items below it without any scroll.
    const resizes = new ResizeObserver(schedule);
    resizes.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resizes.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove("is-reveal-ready");
    };
  }, []);
  return null;
}
