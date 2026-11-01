import { HERO_STORY } from "@/features/marketing/motion";

export type StoryPhase = "idle" | "typing" | "saved" | "suggested" | "approved" | "done";
export interface StoryState {
  phase: StoryPhase;
  typed: number;
  total: number;
}
export type StoryEvent = { type: "replay" } | { type: "next" } | { type: "type" } | { type: "finish" };

export const HERO_STORY_MAX_MS = 3500;

const NEXT_PHASE: Partial<Record<StoryPhase, StoryPhase>> = {
  idle: "typing",
  typing: "saved",
  saved: "suggested",
  suggested: "approved",
  approved: "done",
};

/** The server renders the end of the story; the client replays it from `idle` after hydration. */
export function initialStoryState(total: number): StoryState {
  return { phase: "done", typed: total, total };
}

export function storyReducer(state: StoryState, event: StoryEvent): StoryState {
  switch (event.type) {
    case "replay":
      return { phase: "idle", typed: 0, total: state.total };
    case "finish":
      return { phase: "done", typed: state.total, total: state.total };
    case "type":
      return state.phase === "typing" && state.typed < state.total ? { ...state, typed: state.typed + 1 } : state;
    case "next": {
      const phase = NEXT_PHASE[state.phase];
      if (!phase) return state;
      return { phase, typed: phase === "typing" ? 0 : state.total, total: state.total };
    }
  }
}

/** What happens next and after how long; null once the story is done. */
export function storyNextStep(state: StoryState): { delay: number; event: StoryEvent } | null {
  switch (state.phase) {
    case "idle":
      return { delay: HERO_STORY.startDelay, event: { type: "next" } };
    case "typing":
      return state.typed < state.total
        ? { delay: HERO_STORY.charMs, event: { type: "type" } }
        : { delay: HERO_STORY.savedDelay, event: { type: "next" } };
    case "saved":
      return { delay: HERO_STORY.suggestDelay, event: { type: "next" } };
    case "suggested":
      return { delay: HERO_STORY.approveDelay, event: { type: "next" } };
    case "approved":
      return { delay: HERO_STORY.doneDelay, event: { type: "next" } };
    case "done":
      return null;
  }
}
