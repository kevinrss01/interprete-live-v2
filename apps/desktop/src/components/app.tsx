import { useEffect, useState, type ReactNode } from "react";
import { Interpreter } from "../conversation/interpreter";
import { InterpreterController } from "../lib/interpreter";
import { Onboarding } from "../onboarding/onboarding";
import { loadOnboardingAccount } from "../onboarding/onboarding-account";

type Screen = "onboarding" | "app";

const initialScreen = (): Screen => (loadOnboardingAccount()?.complete ? "app" : "onboarding");

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

  useEffect(() => {
    void controller.init();
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    if (!arriving) return;
    // animationend can be missed if the tab is in the background.
    const stop = window.setTimeout(() => setArriving(false), 620);
    return () => window.clearTimeout(stop);
  }, [arriving]);

  function enterApp() {
    if (!reduceMotion()) setArriving(true);
    setScreen("app");
  }

  function leaveApp() {
    setArriving(false);
    setScreen("onboarding");
  }

  return (
    <>
      {(screen === "onboarding" || arriving) && (
        <ScreenLeave fading={arriving}>
          <Onboarding controller={controller} onDone={enterApp} />
        </ScreenLeave>
      )}
      {screen === "app" && (
        <ScreenEnter fading={arriving} onFaded={() => setArriving(false)}>
          <Interpreter controller={controller} onLeave={leaveApp} />
        </ScreenEnter>
      )}
    </>
  );
}
