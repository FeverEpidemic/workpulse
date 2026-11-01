"use client";

import { useEffect } from "react";

/** A section reveals once its top passes this share of the viewport height. */
const REVEAL_LINE = 0.9;

/**
 * Staged reveal for `[data-reveal]` sections. Items are only hidden under `html.is-reveal-ready`, which this adds
 * after mount, so the page reads fully without JavaScript or with reduced motion. Sections already on screen at
 * mount are marked revealed first, and each section reveals once.
 *
 * A scroll check instead of IntersectionObserver: a fast jump (End key, anchor link) can skip a section without it
 * ever intersecting, and it must not stay hidden above the viewport.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let pending = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    let frame = 0;

    function revealPassed() {
      frame = 0;
      const line = window.innerHeight * REVEAL_LINE;
      pending = pending.filter((section) => {
        if (section.getBoundingClientRect().top >= line) return true;
        section.dataset.revealed = "true";
        return false;
      });
      if (pending.length === 0) stop();
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(revealPassed);
    }

    function stop() {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    }

    for (const section of pending) {
      if (section.getBoundingClientRect().top < window.innerHeight) section.dataset.revealed = "true";
    }
    pending = pending.filter((section) => !section.dataset.revealed);
    root.classList.add("is-reveal-ready");
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      stop();
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove("is-reveal-ready");
    };
  }, []);
  return null;
}
