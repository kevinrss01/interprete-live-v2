import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { Button } from "@interprete/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@interprete/ui/components/select";
import { api } from "../lib/api";
import type { Language } from "@interprete/shared/languages";
import type { Profile } from "@interprete/shared/contracts";
import { cn } from "@interprete/ui/lib/utils";
import { ArrowEnd, englishLanguage, STEP_IN, WIDE } from "./onboarding-profile";

const BARS = [2, 4, 6, 5, 9, 12, 7, 16, 11, 6, 9, 4];
// Languages to hear the voice in, most striking first: the first one that isn't the
// person's own plays by itself. Only for this preview; the other speaker's language
// is set later, in the conversation.
const PREVIEW_LANGUAGES: Language[] = ["ja", "zh", "es", "en", "fr"];
const LINK = "text-[15px] text-(--ink-2) underline underline-offset-3";
const thinkingSteps = (target: Language) => [
  "Listening to your recording…",
  "Capturing your tone and rhythm…",
  `Teaching your voice ${englishLanguage(target)}…`,
  "Almost there…",
];
const THINKING_STEPS = 4;

// The wow moment, reached as soon as the reading ends: the voice is created here,
// then a fixed sentence plays by itself in another language, with the cloned voice
// (ElevenLabs, via the server). The menu at the top plays it in other languages.
export function OnboardingPreview({
  voice,
  status,
  language,
  onContinue,
  onRecordAgain,
  onStandardVoice,
}: {
  voice: string | undefined;
  status: Profile["cloneStatus"];
  language: Language; // the person's own language, never offered here
  onContinue: () => void;
  onRecordAgain: () => void;
  onStandardVoice: () => void;
}) {
  const choices = useMemo(() => PREVIEW_LANGUAGES.filter((l) => l !== language).slice(0, 4), [language]);
  const [target, setTarget] = useState(choices[0]);
  const ready = status === "ready" && !!voice;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  // True once the first sentence is ready, even if the webview blocks autoplay.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let objectUrl = "";
    let live = true;
    setUrl(null);
    setFailed(false);
    (async () => {
      try {
        const response = await api.api.voice.preview.$post({ json: { voice, speaker: "a", language: target } });
        if (!response.ok) throw new Error(`Preview failed (${response.status})`);
        const blob = await response.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) {
        console.warn("Voice preview unavailable", e);
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ready, voice, target, attempt]);

  // Plays as soon as it's ready. If the webview blocks it, the button stays there to tap.
  useEffect(() => {
    if (!url) return;
    setRevealed(true);
    audio.current?.play().catch(() => {});
  }, [url]);

  const waiting = status === "collecting" || status === "creating" || (ready && !url && !failed);

  // The "thinking" line covers the first wait only (cloning, then the first sentence);
  // switching languages afterwards just spins the play button.
  const thinkingNow = waiting && !revealed;
  // Steps the line through, then holds on the last one until the voice is ready.
  const [thinking, setThinking] = useState(0);
  useEffect(() => {
    if (!thinkingNow) return;
    setThinking(0);
    const timer = setInterval(() => setThinking((i) => Math.min(i + 1, THINKING_STEPS - 1)), 1800);
    return () => clearInterval(timer);
  }, [thinkingNow]);

  if (status === "error")
    return (
      <Message title="Your voice could not be created." text="Read the text once more, or continue with a standard voice.">
        <Button type="button" variant="brand" className={WIDE} onClick={onRecordAgain}>
          Record again
          <ArrowEnd />
        </Button>
        <Button type="button" variant="link" className={cn("mt-5", LINK)} onClick={onStandardVoice}>
          Continue with a standard voice
        </Button>
      </Message>
    );

  if (status === "verification")
    return (
      <Message
        title="Your voice is almost ready."
        text="ElevenLabs is verifying it. Until then, a standard voice speaks for you."
      >
        <Button type="button" variant="brand" className={WIDE} onClick={onContinue}>
          Continue
          <ArrowEnd />
        </Button>
      </Message>
    );

  const bars = (
    <span className="inline-flex items-center gap-2.5 max-[860px]:hidden" aria-hidden="true">
      {BARS.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-0.5 rounded-xs transition-colors duration-500",
            playing ? "animate-level bg-brand" : waiting ? "animate-level bg-(--line-2)" : "bg-(--line-2)",
          )}
          style={{ height: h * 3.5, animationDelay: `${i * 70}ms` }}
        />
      ))}
    </span>
  );

  return (
    <div className={cn("flex w-full max-w-[640px] flex-col items-center text-center", STEP_IN)}>
      {/* Fixed height: the thinking line and the reveal take the same room. */}
      <div className="mb-12 flex min-h-36 flex-col items-center justify-end" aria-live="polite">
        {thinkingNow ? (
          // Cloning takes a few seconds: say what's happening, one step at a time.
          // Two elements: each runs its own animation (the step rises in, the light sweeps).
          <p key={thinking} className="animate-rise text-[clamp(26px,3vw,36px)] font-semibold tracking-[-0.03em] [animation-duration:500ms]">
            <span className="text-shimmer">{thinkingSteps(target)[thinking]}</span>
          </p>
        ) : failed ? (
          <>
            <h1 className="text-[clamp(36px,4.6vw,56px)] leading-[1.08] font-bold tracking-[-0.04em]">Almost.</h1>
            <p className="mt-4 text-xl text-muted-foreground">We couldn’t play it this time.</p>
          </>
        ) : (
          <>
            <h1 className="animate-rise text-[clamp(36px,4.6vw,56px)] leading-[1.08] font-bold tracking-[-0.04em]">
              Hey, this is you.
            </h1>
            {/* Hearing the same voice in another language is the point: pick one, it plays. */}
            <p className="mt-3 flex animate-rise items-center gap-2 text-2xl text-muted-foreground [animation-delay:150ms]">
              Speaking
              <Select
                items={choices.map((l) => ({ value: l, label: englishLanguage(l) }))}
                value={target}
                onValueChange={(value) => {
                  const next = choices.find((l) => l === value);
                  if (next) setTarget(next);
                }}
              >
                {/* Plain underlined text with a chevron: part of the sentence, not a field. */}
                <SelectTrigger
                  aria-label="Language of the preview"
                  className="h-auto gap-1 border-0 bg-transparent p-0 text-2xl font-semibold text-foreground underline decoration-2 underline-offset-6 data-[size=default]:h-auto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--ink) dark:bg-transparent [&_svg:not([class*='size-'])]:size-5"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((l) => (
                    <SelectItem key={l} value={l} className="text-base">
                      {englishLanguage(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-8 max-[860px]:gap-4">
        {bars}
        <Button
          type="button"
          variant="brand"
          className={cn(
            "size-36 flex-none rounded-full active:scale-97 [&_svg:not([class*='size-'])]:size-8.5",
            waiting && "animate-pulse disabled:opacity-100",
          )}
          onClick={() =>
            failed ? setAttempt((n) => n + 1) : playing ? audio.current?.pause() : void audio.current?.play()
          }
          aria-label={failed ? "Try again" : playing ? "Pause" : "Play your voice"}
          disabled={waiting}
        >
          {waiting ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : playing ? (
            <Pause fill="currentColor" aria-hidden="true" />
          ) : (
            <Play fill="currentColor" aria-hidden="true" />
          )}
        </Button>
        {bars}
      </div>
      <audio
        ref={audio}
        src={url ?? undefined}
        onPlay={() => {
          setPlaying(true);
          setPlayed(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {/* Shown once the voice has been heard, so the wow can't be skipped. */}
      <div
        className={cn(
          "mt-12 flex w-full flex-col items-center transition-[opacity,visibility] duration-500",
          !(played || failed) && "invisible opacity-0",
        )}
      >
        <Button type="button" variant="brand" className={WIDE} onClick={onContinue}>
          Keep my voice
        </Button>
        <Button type="button" variant="link" className={cn("mt-5", LINK)} onClick={onRecordAgain}>
          Record my voice again
        </Button>
      </div>
    </div>
  );
}

function Message({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className={cn("flex w-full max-w-[460px] flex-col items-center text-center", STEP_IN)}>
      <h1 className="text-[clamp(32px,4vw,48px)] font-bold tracking-[-0.04em]">{title}</h1>
      <p className="mt-3 mb-12 text-xl text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
