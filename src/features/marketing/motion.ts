// T32 landing tempo. Durations of the transitions themselves stay on the CSS motion tokens (--motion-slow);
// these are only the pauses between steps and the typing speed.

export const HERO_STORY = {
  startDelay: 120,
  // Chained timers drift a little in real browsers, so a 90-character note stays near 3.2 s, not at the 3.5 s cap.
  charMs: 22,
  savedDelay: 200,
  suggestDelay: 280,
  approveDelay: 420,
  doneDelay: 200,
} as const;

/** Stagger between items of one section when it scrolls into view. */
export const REVEAL_STAGGER_MS = 80;

/** How long the hero waits for hydration before showing its end state anyway. */
export const HERO_STORY_ARM_TIMEOUT_MS = 3000;

/**
 * Inline script placed just before the hero. It hides the story parts until HeroStory replays the story from the
 * start after hydration, and gives up after the timeout so a page that never hydrates still shows everything.
 * Without JavaScript or with reduced motion it never arms.
 */
export const HERO_STORY_ARM_SCRIPT = [
  "(function(){",
  "var root=document.documentElement;",
  "if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;",
  "root.dataset.heroStory='armed';",
  `setTimeout(function(){if(root.dataset.heroStory==='armed')root.dataset.heroStory='expired';},${HERO_STORY_ARM_TIMEOUT_MS});`,
  "}());",
].join("");
