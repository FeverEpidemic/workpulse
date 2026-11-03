/** An item counts as off screen once less than this share of it, and less than the minimum, is left in the viewport. */
export const REVEAL_EDGE_SHARE = 0.05;

/** Keeps the edge visible on short items: 5% of a title is about 3 px, and a fade there would never be seen. */
export const REVEAL_EDGE_MIN_PX = 24;

export type RevealOffscreen = "above" | "below";

export function revealOffscreen(rect: { top: number; bottom: number }, viewportHeight: number): RevealOffscreen | null {
  const edge = Math.max((rect.bottom - rect.top) * REVEAL_EDGE_SHARE, REVEAL_EDGE_MIN_PX);
  if (rect.bottom < edge) return "above";
  if (viewportHeight - rect.top < edge) return "below";
  return null;
}
