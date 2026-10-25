import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { languageName, type Language } from "@interprete/shared/languages";
import { cn } from "@interprete/ui/lib/utils";
import { onboardingSegments } from "./onboarding-alignment";
import { LanguagePicker, STEP_IN } from "./onboarding-profile";
import { ONBOARDING_TEXTS, onboardingDirection } from "./onboarding-texts";

// Where the current word sits in the prompter, from the top of the visible text.
const ANCHOR = 0.35;
// The reading step, built like a teleprompter: big text in a fixed window that
// scrolls by itself so the current word stays in view. The bottom (consent, then
// the recorder) has a fixed height, so nothing moves when the recording starts.
export function OnboardingReading({
  language,
  text = ONBOARDING_TEXTS[language],
  read,
  live,
  onLanguage,
  children,
}: {
  language: Language;
  text?: string;
  read: number;
  live: boolean;
  onLanguage?: (language: Language) => void; // absent once the recording has started
  children: ReactNode;
}) {
  const segments = useMemo(
    () => onboardingSegments(text, language),
    [text, language],
  );
  const prompter = useRef<HTMLDivElement>(null);

  // Follows the reader: the current word is kept at ANCHOR, never above the start.
  useEffect(() => {
    const box = prompter.current;
    if (!box) return;
    const current = box.querySelector<HTMLElement>("[data-current]");
    const top = current ? current.offsetTop - box.clientHeight * ANCHOR : 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [read, language]);

  let word = -1;
  return (
    // Fills the window; in a window smaller than the default, the page scrolls instead
    // of squeezing the prompter below a few lines (min-h-32).
    <div className={cn("flex min-h-full w-full max-w-[1100px] flex-col self-stretch", STEP_IN)}>
      {/* Everything left-aligned under the title; the language is part of the sentence. */}
      <div className="shrink-0">
        <h1 className="text-[clamp(28px,3vw,40px)] font-bold tracking-[-0.035em]">Read this out loud.</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg text-(--ink-2)">
          My native language is
          {onLanguage ? (
            <>
              <LanguagePicker
                value={language}
                onChange={onLanguage}
                label={`My native language: ${languageName(language)}`}
                className="h-10 w-auto gap-2.5 px-3 text-lg font-semibold text-foreground"
              />
              {/* Ends the sentence right against the menu. */}
              <span className="-ml-1.5">.</span>
            </>
          ) : (
            <span>
              <b className="font-semibold text-foreground">{languageName(language)}</b>.
            </span>
          )}
        </p>
      </div>
      {/* Faded edges: the text slides in and out of view like on a prompter. */}
      <div
        ref={prompter}
        className="relative -mx-3 mt-6 min-h-32 flex-[1_1_0px] overflow-hidden px-3 [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_80%,transparent)]"
      >
        {/* Words are not announced one by one: the full text is read once by screen readers. */}
        <p
          // Readable before the recording; once live, what's left to read is dimmed.
          // The bottom padding lets the last lines scroll up to the anchor.
          className={cn(
            "pt-[0.4em] pb-[40dvh] text-[clamp(26px,min(3.2vw,4.8dvh),44px)] leading-[1.35] font-semibold tracking-[-0.03em] transition-colors duration-300",
            live ? "text-muted-foreground" : "text-(--ink-2)",
          )}
          lang={language}
          dir={onboardingDirection(language)}
        >
          {segments.map((s, i) => {
            if (s.word) word++;
            // The next word to say is marked even before recording: that's where to start.
            const current = s.word && word === read;
            return (
              <span
                key={i}
                data-current={current || undefined}
                className={cn(
                  "rounded-xl transition-colors duration-200",
                  (word < read || current) && "text-foreground",
                  current && "bg-brand/15 ring-6 ring-brand/15",
                )}
              >
                {s.text}
              </span>
            );
          })}
        </p>
      </div>
      <div className="mt-4 h-36 shrink-0">{children}</div>
    </div>
  );
}
