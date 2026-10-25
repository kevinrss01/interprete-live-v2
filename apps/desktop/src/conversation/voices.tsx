import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, Pause, Play } from "lucide-react";
import { LANGUAGES, type Language } from "@interprete/shared/languages";
import type { Profile } from "@interprete/shared/contracts";
import { Button } from "@interprete/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@interprete/ui/components/select";
import type { InterpreterController } from "../lib/interpreter";
import { onboardingReadCount, onboardingWords } from "../onboarding/onboarding-alignment";
import { useVoicePreview } from "../onboarding/onboarding-preview";
import { englishLanguage, OnboardingError } from "../onboarding/onboarding-profile";
import { OnboardingReading } from "../onboarding/onboarding-reading";
import { OnboardingRecorder } from "../onboarding/onboarding-recorder";
import { useOnboardingRecording } from "../onboarding/onboarding-recording";
import { ONBOARDING_TEXTS, onboardingLongText } from "../onboarding/onboarding-texts";
import { SettingsRow, SettingsSection } from "./settings";

type Length = "short" | "long";
const MIN_SECONDS = 10; // ElevenLabs instant cloning minimum, also enforced by the server.
const FIRST_PREVIEW: Language[] = ["ja", "zh", "es", "en", "fr"];

// Speaker A's voice: hear it in other languages, or record it again (short or long text).
export function VoicesPage({ controller, profile, busy }: {
  controller: InterpreterController;
  profile: Profile;
  busy: boolean;
}) {
  const [length, setLength] = useState<Length | null>(null);
  if (length)
    return <VoiceReading controller={controller} language={profile.language} length={length} onClose={() => setLength(null)} />;
  const creating = profile.cloneStatus === "creating";
  return (
    <section className="settings-page" aria-labelledby="voices-title">
      <h1 id="voices-title">Voices</h1>
      <SettingsSection title="Your voice">
        <SettingsRow label="Voice" hint={profile.cloneError}>
          <span className="settings-value settings-status" role="status">
            {creating && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
            {creating
              ? "Creating your voice…"
              : profile.cloneStatus === "ready"
                ? "Your cloned voice"
                : profile.cloneStatus === "verification"
                  ? "Being verified by ElevenLabs"
                  : "Standard voice"}
          </span>
        </SettingsRow>
        <VoicePreviewRow
          voice={profile.cloneStatus === "ready" ? profile.cloneVoice : profile.voice}
          language={profile.language}
          disabled={creating}
        />
      </SettingsSection>
      <SettingsSection title="Record your voice again">
        <SettingsRow label="Short text" hint="About 30 seconds">
          <Button className="btn" disabled={busy || creating} onClick={() => setLength("short")}>
            Read
          </Button>
        </SettingsRow>
        <SettingsRow label="Long text" hint="About 1 minute, for a closer clone">
          <Button className="btn" disabled={busy || creating} onClick={() => setLength("long")}>
            Read
          </Button>
        </SettingsRow>
      </SettingsSection>
      <p className="note settings-footnote">
        Your current voice is replaced once the new recording is complete. The recording is
        sent to ElevenLabs to create your voice.
      </p>
    </section>
  );
}

function VoicePreviewRow({ voice, language, disabled }: { voice?: string; language: Language; disabled: boolean }) {
  const choices = useMemo(() => LANGUAGES.map((l) => l.code).filter((l) => l !== language), [language]);
  const [target, setTarget] = useState(() => FIRST_PREVIEW.find((l) => l !== language) ?? choices[0]);
  // Nothing is synthesized until the first play; after that, picking a language plays it.
  const [requested, setRequested] = useState(false);
  const { url, failed, retry } = useVoicePreview(requested && !disabled ? voice : undefined, target);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (url) audio.current?.play().catch(() => {});
  }, [url]);
  const loading = requested && !url && !failed;
  return (
    <SettingsRow label="Hear it in" hint={failed ? "The preview could not play. Try again." : undefined}>
      <div className="flex w-full items-center gap-2">
        <Select
          items={choices.map((l) => ({ value: l, label: englishLanguage(l) }))}
          value={target}
          onValueChange={(value) => {
            const next = choices.find((l) => l === value);
            if (next) setTarget(next);
          }}
        >
          <SelectTrigger aria-label="Preview language" className="flex-1 bg-(--surface)">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((l) => (
              <SelectItem key={l} value={l}>
                {englishLanguage(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="brand"
          size="icon"
          className="size-10 rounded-full"
          disabled={disabled || loading || !voice}
          aria-label={failed ? "Try again" : playing ? "Pause" : "Play your voice"}
          onClick={() => {
            if (failed) retry();
            else if (!requested) setRequested(true);
            else if (playing) audio.current?.pause();
            else void audio.current?.play();
          }}
        >
          {loading ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : playing ? (
            <Pause fill="currentColor" aria-hidden="true" />
          ) : (
            <Play fill="currentColor" aria-hidden="true" />
          )}
        </Button>
      </div>
      <audio
        ref={audio}
        src={url ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </SettingsRow>
  );
}

// The onboarding teleprompter. The old voice is kept until the new recording is complete.
function VoiceReading({ controller, language, length, onClose }: {
  controller: InterpreterController;
  language: Language;
  length: Length;
  onClose: () => void;
}) {
  const text = length === "long" ? onboardingLongText(language) : ONBOARDING_TEXTS[language];
  const recording = useOnboardingRecording(language);
  const [offset, setOffset] = useState(0);
  const [again, setAgain] = useState(false);
  const finishing = useRef(false);
  const script = useMemo(() => onboardingWords(text, language), [text, language]);
  const heard = useMemo(() => onboardingWords(recording.heard, language), [recording.heard, language]);
  const read = onboardingReadCount(script, heard.slice(offset));
  const recordingNow = recording.status === "recording";

  // Text fully read: finish if the sample is long enough, otherwise read it once more.
  useEffect(() => {
    if (!recordingNow || read < script.length) return;
    if (recording.seconds >= MIN_SECONDS) void finish();
    else {
      setOffset(heard.length);
      setAgain(true);
    }
  }, [recordingNow, read, recording.seconds]);

  async function start() {
    setOffset(0);
    setAgain(false);
    await recording.start();
  }

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const samples = await recording.stop();
      if (samples.reduce((n, s) => n + s.seconds, 0) < MIN_SECONDS) {
        recording.setError("We need about 10 seconds of speech. Start over and read the whole text.");
        return;
      }
      onClose();
      // Starting the reading is the consent; it replaces the previous voice.
      if (!controller.getSnapshot().profiles.a.consent) await controller.setConsent("a", true);
      else await controller.removeVoice("a");
      for (const s of samples) await controller.collect("a", s.blob, s.seconds, { autoClone: false });
      await controller.clone("a");
    } finally {
      finishing.current = false;
    }
  }

  return (
    <div className="flex min-h-full w-full flex-col items-start py-8">
      <Button variant="ghost" className="mb-4 gap-2" onClick={onClose}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to voices
      </Button>
      <OnboardingReading language={language} text={text} read={read} live={recordingNow}>
        {recording.status !== "idle" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-base text-(--ink-2)" role="status">
              {recording.status === "starting"
                ? "Starting the microphone…"
                : again
                  ? "Almost there. Read it once more from the top."
                  : "Recording. Follow the highlighted word."}
            </p>
            {recordingNow && (
              <OnboardingRecorder levels={recording.levels} startedAt={recording.startedAt} onStop={() => void finish()} />
            )}
            {recording.warning && <p className="text-sm text-muted-foreground">{recording.warning}</p>}
          </div>
        ) : (
          <div className="flex h-full flex-col justify-center gap-3">
            <OnboardingError error={recording.error} />
            <Button variant="brand" className="h-14 w-fit px-7 text-[17px] font-semibold" onClick={() => void start()}>
              Accept and start
            </Button>
            <p className="text-sm text-muted-foreground">
              By starting, you allow this recording to be sent to ElevenLabs to create your voice for your translations.
            </p>
          </div>
        )}
      </OnboardingReading>
    </div>
  );
}
