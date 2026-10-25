import { useEffect, useState, useSyncExternalStore } from "react";
import { advanceWordReveal, emptyWordReveal, nextWordReveal } from "../lib/word-reveal";

const motionQuery = "(prefers-reduced-motion: reduce)";
const reducedMotion = () => window.matchMedia(motionQuery).matches;
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function RevealingText({ text, language }: { text: string; language: string }) {
  const [previous, setPrevious] = useState(emptyWordReveal);
  const immediate = useSyncExternalStore(subscribeMotion, reducedMotion, () => true);
  const current = nextWordReveal(previous, text, language, performance.now(), immediate);
  if (current !== previous) setPrevious(current);
  useEffect(() => {
    if (current.visible === current.words.length) return;
    const timer = setTimeout(() => {
      // Browser timers may fire fractionally before their scheduled deadline.
      setPrevious(state => advanceWordReveal(state, Math.max(current.nextAt, performance.now())));
    }, Math.max(0, current.nextAt - performance.now()));
    return () => clearTimeout(timer);
  }, [current]);
  return <>
    {/* Only upstream text changes reach the live region, never animation steps. */}
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{current.words.slice(0, current.visible).map((word) => (
      <span key={word.key} className="live-word">{word.text}</span>
    ))}</span>
  </>;
}

export function LiveText({ text, language, live }: { text: string; language: string; live: boolean }) {
  const [streamed, setStreamed] = useState(live);
  if (live && !streamed) setStreamed(true);
  // Finalization drains the existing queue; historical passages still render immediately.
  return live || streamed ? <RevealingText key={language} text={text} language={language} /> : <>{text}</>;
}
