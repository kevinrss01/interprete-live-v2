import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import type { Language } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { rpc, signUp } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { loadOnboardingAccount, saveOnboardingAccount, type OnboardingAccount } from "./onboarding-account";
import { onboardingReadCount, onboardingWords } from "./onboarding-alignment";
import { DevButton, OnboardingPage, OnboardingStepper, type OnboardingStep } from "./onboarding-header";
import { Auth, type AuthScreen } from "./auth";
import { OnboardingPreview } from "./onboarding-preview";
import {
  OnboardingError,
  OnboardingProfile,
  systemLanguage,
  type OnboardingProfileValues,
} from "./onboarding-profile";
import { OnboardingReading } from "./onboarding-reading";
import { OnboardingRecorder } from "./onboarding-recorder";
import { OnboardingStart } from "./onboarding-start";
import { useOnboardingRecording } from "./onboarding-recording";
import { ONBOARDING_TEXTS } from "./onboarding-texts";
import { isTauri } from "@tauri-apps/api/core";
import { setupDecision } from "../lib/mac-setup";
import { MacSetup } from "./mac-setup";

const STATUS = "flex items-center justify-center gap-2 text-base text-(--ink-2)";
const LINK = "text-[15px] text-(--ink-2) underline underline-offset-3";
const QUIET = "text-[15px] text-(--ink-2)";
const ACTION = "h-14 px-7 text-[17px] font-semibold";
const MIN_SECONDS = 10; // ElevenLabs instant cloning minimum, also enforced by the server.

// Intro → reading (consent built in) → hearing the voice → account. The voice and the
// preview only need the device session, so the account comes last, after the wow.
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
  const language = profile.language;
  const target = state.profiles.b.language;
  // An account created by the previous flow (account first) skips the account step.
  const [account] = useState<OnboardingAccount | null>(loadOnboardingAccount);
  const [step, setStep] = useState<OnboardingStep>("intro");
  // Log in stays inside this screen, so the page and its logo are not remounted.
  const [auth, setAuth] = useState<AuthScreen | null>(null);
  const recording = useOnboardingRecording(language);
  const [offset, setOffset] = useState(0);
  const [again, setAgain] = useState(false);
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

  // The two speakers need different languages: the preview speaks the other one.
  function setLanguage(next: Language) {
    controller.setProfile("a", { language: next });
    if (controller.getSnapshot().profiles.b.language === next)
      controller.setProfile("b", { language: next === "en" ? "fr" : "en" });
  }

  function startVoice() {
    const p = controller.getSnapshot().profiles.a;
    // Back after closing the app: a voice already exists, go straight to hearing it.
    if (p.cloneVoice && (p.cloneStatus === "ready" || p.cloneStatus === "verification")) setStep("preview");
    else {
      setLanguage(systemLanguage());
      setStep("voice");
    }
  }
  function start() {
    if (isTauri() && !setupDecision()) setStep("setup");
    else startVoice();
  }

  // Creates the Better Auth account (email is unique), then saves both languages.
  async function createAccount({ password, ...values }: OnboardingProfileValues) {
    try {
      await signUp({ name: values.firstName, email: values.email, password });
    } catch (e) {
      return e instanceof Error ? e.message : "Your account could not be created. Try again.";
    }
    // ponytail: the account already exists here, so a failed save must not block the flow;
    // the languages are also kept on the device and can be saved again later.
    await rpc.preferences
      .update({ sourceLanguage: language, targetLanguage: target })
      .catch((e) => console.warn("Preferences not saved", e));
    saveOnboardingAccount({ ...values, language, complete: true });
    controller.setProfile("a", { name: values.firstName });
    // The voice was created before the account: attach it now.
    await controller.syncAccountVoice();
    onDone();
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
      // The listening screen covers the wait: the voice is created behind it.
      setStep("preview");
      for (const s of samples) await controller.collect("a", s.blob, s.seconds);
      await controller.clone("a");
    } finally {
      finishing.current = false;
    }
  }

  function skipForDev() {
    saveOnboardingAccount({ firstName: "Dev", email: "dev@localhost", language, complete: true });
    onDone();
  }

  // After the voice (or without one): the account, unless it already exists.
  function next() {
    if (!account) return setStep("account");
    saveOnboardingAccount({ ...account, language, complete: true });
    onDone();
  }

  async function useStandardVoice() {
    recording.reset();
    // Withdrawing consent also deletes a voice that may already exist.
    if (controller.getSnapshot().profiles.a.consent) await controller.setConsent("a", false);
    next();
  }

  async function recordAgain() {
    await controller.removeVoice("a");
    setStep("voice");
    await startRecording();
  }

  const error = recording.error;

  let bottom;
  if (recording.status !== "idle")
    bottom = (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className={STATUS} role="status">
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
        <Button type="button" variant="link" className={LINK} onClick={() => void startRecording()}>
          Start over
        </Button>
      </div>
    );
  else
    bottom = (
      <div className="flex h-full flex-col justify-center gap-3">
        <OnboardingError error={error} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button type="button" variant="brand" className={`${ACTION} gap-6`} onClick={() => void startRecording()}>
            Accept and start
            <ArrowRight aria-hidden="true" />
          </Button>
          {/* Not a second option of equal weight: a quiet way out, the voice can be added later. */}
          <Button type="button" variant="link" className={LINK} onClick={() => void useStandardVoice()}>
            I don’t want to use my voice right now
          </Button>
        </div>
        {/* The consent the button accepts, right under it. */}
        <p className="text-sm text-muted-foreground">
          By starting, you allow this recording to be sent to ElevenLabs to create your voice for your translations.
        </p>
      </div>
    );

  return (
    <OnboardingPage
      scrollSafe={!auth && step === "setup"}
      action={
        !auth && step === "intro" && import.meta.env.DEV ? (
          // Dev only: open the app without creating an account each time.
          <DevButton onClick={skipForDev}>dev: skip onboarding</DevButton>
        ) : step === "voice" && recording.status !== "idle" ? (
          <Button type="button" variant="ghost" className={QUIET} onClick={recording.reset}>
            Cancel
          </Button>
        ) : null
      }
      footer={
        // Hidden on the intro and while recording: one thing to focus on.
        !auth && step !== "intro" && recording.status === "idle" && <OnboardingStepper step={step} macSetup={isTauri()} />
      }
    >
      {auth && (
        <Auth
          screen={auth}
          controller={controller}
          onNavigate={setAuth}
          onSignUp={() => setAuth(null)}
          onSignedIn={onDone}
        />
      )}
      {!auth && step === "intro" && <OnboardingStart onStart={start} onLogin={() => setAuth("login")} />}
      {!auth && step === "setup" && <MacSetup onDone={startVoice} />}
      {!auth && step === "voice" && (
        <OnboardingReading
          language={language}
          read={read}
          live={recordingNow}
          onLanguage={recording.status === "idle" ? setLanguage : undefined}
        >
          {bottom}
        </OnboardingReading>
      )}
      {!auth && step === "preview" && (
        <OnboardingPreview
          voice={profile.cloneVoice}
          status={profile.cloneStatus}
          language={language}
          onContinue={next}
          onRecordAgain={() => void recordAgain()}
          onStandardVoice={() => void useStandardVoice()}
        />
      )}
      {!auth && step === "account" && (
        <OnboardingProfile
          hasVoice={profile.consent && (profile.cloneStatus === "ready" || profile.cloneStatus === "verification")}
          onSubmit={createAccount}
          onLogin={() => setAuth("login")}
        />
      )}
    </OnboardingPage>
  );
}
