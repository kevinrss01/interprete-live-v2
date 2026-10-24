import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Pause, Play } from "lucide-react";
import { api } from "../lib/api";
import { languageNative, type Language } from "@interprete/shared/languages";
import { formatOnboardingTime } from "./onboarding-recorder";

const BARS = [2, 4, 6, 5, 9, 12, 7, 16, 11, 6, 9, 4];

// Plays a new sentence said by the cloned voice (ElevenLabs, via the server).
// Falls back to the person's own recording when the voice can't be read yet
// (verification pending, provider error).
export function OnboardingPreview({
  voice,
  sample,
  language,
  verification,
  onStart,
  onRecordAgain,
}: {
  voice: string | undefined;
  sample: Blob;
  language: Language;
  verification: boolean;
  onStart: () => void;
  onRecordAgain: () => void;
}) {
  const [source, setSource] = useState<{ url: string; cloned: boolean } | null>(null);
  useEffect(() => {
    let url = "";
    let live = true;
    (async () => {
      let blob = sample, cloned = false;
      if (voice && !verification) {
        try {
          const response = await api.api.voice.preview.$post({ json: { voice, speaker: "a", language } });
          if (response.ok) {
            blob = await response.blob();
            cloned = true;
          }
        } catch {}
      }
      if (!live) return;
      url = URL.createObjectURL(blob);
      setSource({ url, cloned });
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [voice, sample, language, verification]);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = (
    <span className="onboarding-bars onboarding-preview-bars" data-playing={playing} aria-hidden="true">
      {BARS.map((h, i) => (
        <span key={i} style={{ height: h * 3.5, animationDelay: `${i * 70}ms` }} />
      ))}
    </span>
  );
  return (
    <div className="onboarding-preview">
      <h1>Here’s your voice.</h1>
      <p className="onboarding-preview-sub">
        {!source ? "Preparing your voice…" : source.cloned ? "Synthesized preview" : "Your recording"} ·{" "}
        {languageNative(language)}
      </p>
      <div className="onboarding-player">
        {bars}
        <button
          type="button"
          className="onboarding-play"
          onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
          aria-label={playing ? "Pause" : "Play your voice"}
          disabled={!source}
        >
          {!source ? (
            <LoaderCircle size={34} className="spin" aria-hidden="true" />
          ) : playing ? (
            <Pause size={34} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={34} fill="currentColor" aria-hidden="true" />
          )}
        </button>
        {bars}
      </div>
      <time className="onboarding-preview-time">
        {formatOnboardingTime(playing ? time : duration)}
      </time>
      <audio
        ref={audio}
        src={source?.url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      {verification && (
        <p className="onboarding-hint">
          ElevenLabs needs to verify this voice. A standard voice is used until then.
        </p>
      )}
      <button type="button" className="onboarding-primary onboarding-wide" onClick={onStart}>
        Start talking
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <button type="button" className="onboarding-link" onClick={onRecordAgain}>
        Record my voice again
      </button>
    </div>
  );
}
