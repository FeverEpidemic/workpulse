"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

import { StepDots } from "@/features/marketing/step-dots";
import type { Locale } from "@/i18n/messages";

export interface DemoTab {
  id: string;
  label: string;
  title: string;
  body: string;
  steps: [from: number, to: number];
  example: ReactNode;
}

const subscribeNothing = () => () => {};

/**
 * ARIA tabs for the three steps. The server renders every panel so the section reads in order without
 * JavaScript; after hydration only the selected panel stays visible.
 */
export function DemoTabs({ tabs, label, locale }: { tabs: DemoTab[]; label: string; locale: Locale }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [selected, setSelected] = useState(0);
  // The side the new panel slides in from; unset until the first switch, so nothing moves on load.
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs[selected]!;

  function select(index: number, from: "left" | "right" = index > selected ? "right" : "left") {
    if (index !== selected) setDirection(from);
    setSelected(index);
    tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = tabs.length - 1;
    const moves: Record<string, [number, "left" | "right"]> = {
      ArrowRight: [selected === last ? 0 : selected + 1, "right"],
      ArrowLeft: [selected === 0 ? last : selected - 1, "left"],
      Home: [0, "left"],
      End: [last, "right"],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    select(...move);
  }

  return (
    <div className="landing-demo" data-hydrated={hydrated ? "true" : "false"}>
      <div className="landing-demo-bar">
        <div role="tablist" aria-label={label} className="landing-tablist" onKeyDown={onKeyDown}>
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`landing-tab-${tab.id}`}
              aria-controls={`landing-panel-${tab.id}`}
              aria-selected={index === selected}
              tabIndex={index === selected ? 0 : -1}
              className="landing-tab"
              onClick={() => select(index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <StepDots from={current.steps[0]} to={current.steps[1]} locale={locale} />
      </div>
      <div className="landing-panels" data-direction={hydrated && direction ? direction : undefined}>
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`landing-panel-${tab.id}`}
            aria-labelledby={`landing-tab-${tab.id}`}
            className="landing-panel"
            tabIndex={0}
            hidden={hydrated && index !== selected}
          >
            <div className="landing-panel-text">
              <h3 className="landing-panel-title">{tab.title}</h3>
              <p className="landing-body">{tab.body}</p>
            </div>
            {tab.example}
          </div>
        ))}
      </div>
    </div>
  );
}
