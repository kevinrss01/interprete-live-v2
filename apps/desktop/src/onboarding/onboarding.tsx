import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { rpc, signUp } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { loadOnboardingAccount, saveOnboardingAccount, type OnboardingAccount } from "./onboarding-account";
import { onboardingReadCount, onboardingWords } from "./onboarding-alignment";
import { OnboardingHeader, OnboardingStepper, type OnboardingStep } from "./onboarding-header";
import { Auth, type AuthScreen } from "./auth";
import { OnboardingPreview } from "./onboarding-preview";
import { OnboardingProfile, type OnboardingProfileValues } from "./onboarding-profile";
import { OnboardingReading } from "./onboarding-reading";
import { OnboardingRecorder } from "./onboarding-recorder";
import { useOnboardingRecording } from "./onboarding-recording";
import { ONBOARDING_TEXTS } from "./onboarding-texts";
import "./onboarding.css";

const MIN_SECONDS = 10; // ElevenLabs instant cloning minimum, also enforced by the server.

// Profile → consent built into the reading → progressive reading → listening.
// Only speaker A is onboarded; speaker B stays in Settings.
export function Onboarding({
  controller,
  onDone,
}: {
  controller: InterpreterController;
  onDone: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const profile = state.profiles.a;
  const [account, setAccount] = useState<OnboardingAccount | null>(loadOnboardingAccount);
  const [step, setStep] = useState<OnboardingStep>(account ? "voice" : "profile");
  // Login stays inside this screen so the logo header is not remounted.
  const [auth, setAuth] = useState<AuthScreen | null>(null);
  // Direction of the last login ↔ create-account switch. Null until the first switch,
  // so the opening screen does not animate in.
  const [motion, setMotion] = useState<"forward" | "back" | null>(null);
  const language = account?.language ?? profile.language;
  const recording = useOnboardingRecording(language);
  const [offset, setOffset] = useState(0);
  const [again, setAgain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState<Blob | null>(null);
  const finishing = useRef(false);

  const script = useMemo(() => onboardingWords(ONBOARDING_TEXTS[language], language), [language]);
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

  // Creates the Better Auth account (email is unique), then saves the language.
  async function createAccount({ password, ...values }: OnboardingProfileValues) {
    try {
      await signUp({ name: values.firstName, email: values.email, password });
    } catch (e) {
      return e instanceof Error ? e.message : "Your account could not be created. Try again.";
    }
    const target = state.profiles.b.language === values.language
      ? values.language === "en" ? "fr" : "en"
      : state.profiles.b.language;
    // ponytail: the account already exists here, so a failed save must not block the flow;
    // the language is also kept on the device and can be saved again later.
    await rpc.preferences
      .update({ sourceLanguage: values.language, targetLanguage: target })
      .catch((e) => console.warn("Preferences not saved", e));
    const next = { ...values, complete: false };
    saveOnboardingAccount(next);
    setAccount(next);
    controller.setProfile("a", { name: values.firstName, language: values.language });
    controller.setProfile("b", { language: target });
    setStep("voice");
    return null;
  }

  async function startRecording() {
    setOffset(0);
    setAgain(false);
    const p = controller.getSnapshot().profiles.a;
    if (!p.consent) await controller.setConsent("a", true);
    else if (p.cloneStatus !== "collecting") await controller.removeVoice("a");
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
      setSaving(true);
      setSample(samples[0].blob);
      for (const s of samples) await controller.collect("a", s.blob, s.seconds);
      await controller.clone("a");
      const status = controller.getSnapshot().profiles.a.cloneStatus;
      if (status === "ready" || status === "verification") setStep("preview");
    } finally {
      setSaving(false);
      finishing.current = false;
    }
  }

  function skipForDev() {
    saveOnboardingAccount({ firstName: "Dev", email: "dev@localhost", language: profile.language, complete: true });
    onDone();
  }

  function complete() {
    if (account) saveOnboardingAccount({ ...account, complete: true });
    onDone();
  }

  async function useStandardVoice() {
    recording.reset();
    // Withdrawing consent also deletes a voice that may already exist.
    if (controller.getSnapshot().profiles.a.consent) await controller.setConsent("a", false);
    complete();
  }

  async function recordAgain() {
    await controller.removeVoice("a");
    setSample(null);
    setStep("voice");
    await startRecording();
  }

  const error =
    recording.error ??
    (profile.cloneStatus === "error"
      ? "Your voice could not be created. Try again or use a standard voice."
      : null);

  let bottom;
  if (recording.status !== "idle")
    bottom = (
      <div className="onboarding-live">
        <p className="onboarding-status" role="status">
          {recording.status === "starting"
            ? "Starting the microphone…"
            : again
              ? "Almost there. Read it once more."
              : "Recording"}
        </p>
        {recordingNow && (
          <OnboardingRecorder levels={recording.levels} startedAt={recording.startedAt} onStop={() => void finish()} />
        )}
        {recording.warning && <p className="onboarding-hint">{recording.warning}</p>}
        <button type="button" className="onboarding-link" onClick={() => void startRecording()}>
          Start over
        </button>
      </div>
    );
  else if (saving)
    bottom = (
      <p className="onboarding-status" role="status">
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
        Creating your voice…
      </p>
    );
  else
    bottom = (
      <div className="onboarding-consent">
        {error && (
          <p className="onboarding-error" role="alert">
            {error}
          </p>
        )}
        <p>
          I allow this recording to be sent to ElevenLabs to create my voice
          <br />
          and use it in my translations.
        </p>
        <div className="onboarding-actions">
          <button type="button" className="onboarding-primary" onClick={() => void startRecording()}>
            Accept and start
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="onboarding-secondary" onClick={() => void useStandardVoice()}>
            Use a standard voice
          </button>
        </div>
      </div>
    );

  return (
    <div className="onboarding">
      <OnboardingHeader
        action={
          step === "profile" && import.meta.env.DEV ? (
            // Dev only: open the app without creating an account each time.
            <button type="button" className="onboarding-dev" onClick={skipForDev}>
              dev: skip onboarding
            </button>
          ) : step !== "voice" || saving ? null : recording.status !== "idle" ? (
            <button type="button" className="onboarding-quiet" onClick={recording.reset}>
              Cancel
            </button>
          ) : (
            <button type="button" className="onboarding-quiet" onClick={() => void useStandardVoice()}>
              Skip
            </button>
          )
        }
      />
      <main className="onboarding-main">
        {(auth || step === "profile") && (
          <div key={auth ? "auth" : "signup"} className="onboarding-switch-panel" data-motion={motion ?? undefined}>
            {auth ? (
              <Auth
                screen={auth}
                controller={controller}
                onNavigate={setAuth}
                onSignUp={() => {
                  setMotion("back");
                  setAuth(null);
                }}
                onSignedIn={onDone}
              />
            ) : (
              <OnboardingProfile
                onSubmit={createAccount}
                onLogin={() => {
                  setMotion("forward");
                  setAuth("login");
                }}
              />
            )}
          </div>
        )}
        {step === "voice" && !auth && (
          <OnboardingReading language={language} read={read} live={recordingNow}>
            {bottom}
          </OnboardingReading>
        )}
        {step === "preview" && sample && !auth && (
          <OnboardingPreview
            voice={profile.cloneVoice}
            sample={sample}
            language={language}
            verification={profile.cloneStatus === "verification"}
            onStart={complete}
            onRecordAgain={() => void recordAgain()}
          />
        )}
      </main>
      {/* Hidden while recording: one thing to focus on. */}
      {recording.status === "idle" && !saving && <OnboardingStepper step={step} />}
    </div>
  );
}
