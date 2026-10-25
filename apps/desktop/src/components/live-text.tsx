import { useState } from "react";
import { emptyWordReveal, nextWordReveal } from "../lib/word-reveal";

function RevealingText({ text, language }: { text: string; language: string }) {
  const [previous, setPrevious] = useState(emptyWordReveal);
  const current = nextWordReveal(previous, text, language, performance.now());
  if (current !== previous) setPrevious(current);
  return <>
    {/* Only upstream text changes reach the live region, never animation steps. */}
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{current.words.map((word) => (
      <span key={word.key} className="live-word" style={{ animationDelay: `${word.delay}ms` }}>{word.text}</span>
    ))}</span>
  </>;
}

export function LiveText({ text, language, live }: { text: string; language: string; live: boolean }) {
  return live ? <RevealingText key={language} text={text} language={language} /> : <>{text}</>;
}
