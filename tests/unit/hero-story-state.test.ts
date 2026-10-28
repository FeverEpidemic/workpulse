import { describe, expect, it } from "vitest";

import { HERO_STORY_MAX_MS, initialStoryState, storyNextStep, storyReducer, type StoryState } from "@/features/marketing/hero-story-state";

function run(state: StoryState) {
  const phases: string[] = [state.phase];
  let elapsed = 0;
  for (let step = storyNextStep(state); step; step = storyNextStep(state)) {
    elapsed += step.delay;
    state = storyReducer(state, step.event);
    if (phases.at(-1) !== state.phase) phases.push(state.phase);
  }
  return { state, phases, elapsed };
}

describe("T32 hero story state", () => {
  it("starts in the final state so the server markup is complete", () => {
    expect(initialStoryState(82)).toEqual({ phase: "done", typed: 82, total: 82 });
    expect(storyNextStep(initialStoryState(82))).toBeNull();
  });

  it("runs log, save, suggest, approve, done once, in order", () => {
    const { phases, state } = run(storyReducer(initialStoryState(82), { type: "replay" }));
    expect(phases).toEqual(["idle", "typing", "saved", "suggested", "approved", "done"]);
    expect(state).toEqual({ phase: "done", typed: 82, total: 82 });
  });

  it("types one character per step", () => {
    let state = storyReducer(storyReducer(initialStoryState(5), { type: "replay" }), { type: "next" });
    expect(state).toEqual({ phase: "typing", typed: 0, total: 5 });
    state = storyReducer(state, { type: "type" });
    expect(state.typed).toBe(1);
  });

  it.each([74, 82, 90])("finishes a %i-character note within 3.5 seconds", (chars) => {
    const { elapsed } = run(storyReducer(initialStoryState(chars), { type: "replay" }));
    expect(HERO_STORY_MAX_MS).toBe(3500);
    expect(elapsed).toBeLessThanOrEqual(HERO_STORY_MAX_MS);
    expect(elapsed).toBeGreaterThan(2000);
  });

  it("replays from idle with nothing typed", () => {
    expect(storyReducer(initialStoryState(82), { type: "replay" })).toEqual({ phase: "idle", typed: 0, total: 82 });
  });

  it("jumps straight to the end when finished early (reduced motion, hidden tab)", () => {
    const typing = { phase: "typing" as const, typed: 12, total: 82 };
    expect(storyReducer(typing, { type: "finish" })).toEqual({ phase: "done", typed: 82, total: 82 });
  });

  it("ignores typing outside the typing phase", () => {
    const saved = { phase: "saved" as const, typed: 82, total: 82 };
    expect(storyReducer(saved, { type: "type" })).toBe(saved);
  });
});
