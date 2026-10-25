import { useEffect, useState, type ReactNode } from "react";
import { Interpreter } from "../conversation/interpreter";
import { InterpreterController } from "../lib/interpreter";
import { Onboarding } from "../onboarding/onboarding";
import { loadOnboardingAccount } from "../onboarding/onboarding-account";
import { isTauri } from "@tauri-apps/api/core";
import { MacSetup } from "../onboarding/mac-setup";
import { OnboardingPage } from "../onboarding/onboarding-header";
import { missingSetup, readMacSetup, setupDecision, systemAudioEvidence } from "../lib/mac-setup";

type Screen = "onboarding" | "setup" | "app";

const initialScreen = (): Screen => loadOnboardingAccount()?.complete
  ? isTauri() && !setupDecision() ? "setup" : "app"
  : "onboarding";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ScreenLeave({ fading, children }: { fading: boolean; children: ReactNode }) {
  return (
    <div className={fading ? "screen-leave" : undefined} inert={fading}>
      {children}
    </div>
  );
}

function ScreenEnter({
  fading,
  onFaded,
  children,
}: {
  fading: boolean;
  onFaded: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={fading ? "screen-enter" : undefined}
      inert={fading}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "screen-enter") onFaded();
      }}
    >
      {children}
    </div>
  );
}

// One controller for onboarding and conversation: they share profile, consent and voice.
export function App() {
  const [controller] = useState(() => new InterpreterController());
  const [screen, setScreen] = useState<Screen>(initialScreen);
  // True only for the onboarding → app handoff, so a reload into the app stays still.
  const [arriving, setArriving] = useState(false);
  const [returnView, setReturnView] = useState<"conversation" | "call" | "settings">("conversation");

  useEffect(() => {
    void controller.init();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (!isTauri() || !loadOnboardingAccount()?.complete || setupDecision() !== "ready") return;
    let current = true;
    void readMacSetup().then(status => {
      if (current && missingSetup(status, systemAudioEvidence()).length) {
        controller.cancel();
        setScreen("setup");
      }
    }).catch(() => { if (current) setScreen("setup"); });
    return () => { current = false; };
  }, [controller]);

  useEffect(() => {
    if (!arriving) return;
    // animationend can be missed if the tab is in the background.
    const stop = window.setTimeout(() => setArriving(false), 620);
    return () => window.clearTimeout(stop);
  }, [arriving]);

  function enterApp() {
    if (isTauri() && !setupDecision()) { setScreen("setup"); return; }
    if (screen === "setup" && setupDecision() === "later" && returnView === "call") setReturnView("conversation");
    setArriving(screen === "onboarding" && !reduceMotion());
    setScreen("app");
  }

  function leaveApp() {
    setArriving(false);
    setScreen("onboarding");
    setReturnView("conversation");
  }
  function openMacSetup(view: "call" | "settings") {
    controller.cancel();
    setArriving(false);
    setReturnView(view);
    setScreen("setup");
  }

  return (
    <>
      {screen === "setup" && <OnboardingPage scrollSafe><MacSetup onDone={enterApp} /></OnboardingPage>}
      {(screen === "onboarding" || arriving) && (
        <ScreenLeave fading={arriving}>
          <Onboarding controller={controller} onDone={enterApp} />
        </ScreenLeave>
      )}
      {screen === "app" && (
        <ScreenEnter fading={arriving} onFaded={() => setArriving(false)}>
          <Interpreter controller={controller} onLeave={leaveApp} initialView={returnView} onMacSetup={openMacSetup} />
        </ScreenEnter>
      )}
    </>
  );
}
