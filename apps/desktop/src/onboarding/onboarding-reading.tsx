import { useMemo, type ReactNode } from "react";
import { languageNative, type Language } from "@interprete/shared/languages";
import { onboardingSegments } from "./onboarding-alignment";
import { ONBOARDING_TEXTS, onboardingDirection } from "./onboarding-texts";

// Steps 2 and 3 share this scene: the text stays put, only the bottom changes
// (consent, then the recorder).
export function OnboardingReading({
  language,
  read,
  live,
  children,
}: {
  language: Language;
  read: number;
  live: boolean;
  children: ReactNode;
}) {
  const segments = useMemo(
    () => onboardingSegments(ONBOARDING_TEXTS[language], language),
    [language],
  );
  let word = -1;
  return (
    <div className="onboarding-reading">
      <div className="onboarding-reading-meta">
        <span>Read aloud</span>
        <span>{languageNative(language)} · about 30 s</span>
      </div>
      {/* Words are not announced one by one: the full text is read once by screen readers. */}
      <p className="onboarding-reading-text" lang={language} dir={onboardingDirection(language)}>
        {segments.map((s, i) => {
          if (s.word) word++;
          const state =
            word < read ? "read" : live && s.word && word === read ? "current" : undefined;
          return (
            <span key={i} data-state={state}>
              {s.text}
            </span>
          );
        })}
      </p>
      <div className="onboarding-reading-bottom">{children}</div>
    </div>
  );
}
