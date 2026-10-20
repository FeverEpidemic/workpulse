"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export const CHROME_TOP = 24;
export const CHROME_DELTA = 8;

export type ChromeState = { compact: boolean; lastY: number };

export function expandedChrome(scrollY: number): ChromeState {
  return { compact: false, lastY: scrollY };
}

// Small moves are not recorded, so slow drags add up until they pass the delta and iOS momentum bounces do not flicker.
export function nextChrome(state: ChromeState, scrollY: number): ChromeState {
  if (scrollY <= CHROME_TOP) {
    return !state.compact && state.lastY === scrollY ? state : expandedChrome(scrollY);
  }
  const delta = scrollY - state.lastY;
  if (delta >= CHROME_DELTA) return { compact: true, lastY: scrollY };
  if (delta <= -CHROME_DELTA) return expandedChrome(scrollY);
  return state;
}

export function headerShouldHide({ compact, focusWithin, sheetOpen }: {
  compact: boolean;
  focusWithin: boolean;
  sheetOpen: boolean;
}): boolean {
  return compact && !focusWithin && !sheetOpen;
}

export function useScrollChrome(): { compact: boolean; headerHidden: boolean; expand(): void } {
  const pathname = usePathname();
  const [chrome, setChrome] = useState(() => ({ pathname, state: expandedChrome(0) }));
  // A new page starts expanded; the scroll listener picks up its real position on the next frame.
  const current = chrome.pathname === pathname ? chrome.state : expandedChrome(0);
  if (chrome.pathname !== pathname) setChrome({ pathname, state: current });

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setChrome((previous) => {
          const state = nextChrome(previous.state, window.scrollY);
          return state === previous.state ? previous : { pathname: previous.pathname, state };
        });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const expand = useCallback(() => {
    setChrome((previous) => previous.state.compact
      ? { pathname: previous.pathname, state: expandedChrome(window.scrollY) }
      : previous);
  }, []);

  return { compact: current.compact, headerHidden: current.compact, expand };
}
