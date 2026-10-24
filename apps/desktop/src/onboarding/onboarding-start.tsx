import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@interprete/ui/components/button";
import { cn } from "@interprete/ui/lib/utils";
import { ArrowEnd, INLINE_LINK } from "./onboarding-profile";

// "Hello" in a few of the supported languages, cycling above the title.
const GREETINGS: [string, string][] = [
  ["en", "Hello"],
  ["fr", "Bonjour"],
  ["es", "Hola"],
  ["ja", "こんにちは"],
  ["de", "Hallo"],
  ["ko", "안녕하세요"],
  ["it", "Ciao"],
  ["ar", "مرحبا"],
  ["zh", "你好"],
  ["ru", "Привет"],
];
const BARS = [3, 6, 10, 7, 14, 18, 11, 22, 15, 9, 13, 6, 4];
const LINES = ["All your languages.", "All your words.", "Always your voice."];

// Animation delay for the nth element of the sequence.
const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

// First screen: the promise, line by line, then one action.
// ponytail: no sound design yet; add it here once there is an audio asset.
export function OnboardingStart({ onStart, onLogin }: { onStart: () => void; onLogin: () => void }) {
  const [greeting, setGreeting] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setGreeting((i) => (i + 1) % GREETINGS.length), 1600);
    return () => clearInterval(timer);
  }, []);
  const [lang, word] = GREETINGS[greeting];
  return (
    <div className="flex w-full max-w-[900px] flex-col items-center text-center">
      <span className="flex h-16 animate-rise items-center gap-2" aria-hidden="true">
        {BARS.map((h, i) => (
          <span
            key={i}
            className="w-1 animate-level rounded-full bg-brand"
            style={{ height: h * 2.6, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </span>
      <p className="mt-6 h-9 text-2xl font-medium text-brand" aria-hidden="true">
        <span key={greeting} lang={lang} className="inline-block animate-rise [animation-duration:600ms]">
          {word}
        </span>
      </p>
      <h1 className="mt-4 text-[clamp(40px,min(6.4vw,10dvh),92px)] leading-[1.04] font-bold tracking-[-0.05em]">
        {LINES.map((line, i) => (
          <span
            key={line}
            className={cn("block animate-rise", i === LINES.length - 1 && "text-muted-foreground")}
            style={at(250 + i * 380)}
          >
            {line}
          </span>
        ))}
      </h1>
      <p className="mt-7 animate-rise text-xl text-(--ink-2)" style={at(1500)}>
        Speak. They hear you in their language, with your voice.
      </p>
      <div className="mt-12 flex w-full max-w-[360px] animate-rise flex-col items-center gap-5" style={at(1800)}>
        <Button type="button" variant="brand" className="relative h-14 w-full text-[17px] font-semibold" onClick={onStart}>
          Get started
          <ArrowEnd />
        </Button>
        <p className="text-[15px] text-muted-foreground">
          Already have an account?{" "}
          <Button type="button" variant="link" className={INLINE_LINK} onClick={onLogin}>
            Log in
          </Button>
        </p>
      </div>
    </div>
  );
}
