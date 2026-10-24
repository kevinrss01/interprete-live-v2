import { Component, StrictMode, useEffect, useState, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./globals.css";
import { TranslationOverlay } from "./components/translation-overlay";
import { CallToast } from "./components/call-toast";
import { Interpreter } from "./components/interpreter";
import { InterpreterController } from "./lib/interpreter";
import { Onboarding } from "./onboarding/onboarding";
import { loadOnboardingAccount } from "./onboarding/onboarding-account";
import { Auth, type AuthScreen } from "./auth/auth";

class ErrorBoundary extends Component<{ children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-page">
        <h1>La conversation a été interrompue.</h1>
        <p>Rechargez l’interface pour reprendre.</p>
        <button onClick={() => location.reload()}>Réessayer</button>
      </main>
    );
  }
}

// One controller for onboarding and conversation: they share profile, consent and voice.
function App() {
  const [controller] = useState(() => new InterpreterController());
  const [screen, setScreen] = useState<"onboarding" | AuthScreen | "app">(() =>
    loadOnboardingAccount()?.complete ? "app" : "onboarding",
  );
  useEffect(() => {
    void controller.init();
    return () => controller.dispose();
  }, [controller]);
  if (screen === "app") return <Interpreter controller={controller} />;
  if (screen === "onboarding")
    return (
      <Onboarding controller={controller} onDone={() => setScreen("app")} onLogin={() => setScreen("login")} />
    );
  return (
    <Auth
      screen={screen}
      controller={controller}
      onNavigate={setScreen}
      onSignUp={() => setScreen("onboarding")}
      onSignedIn={() => setScreen("app")}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      {location.hash === "#translation-overlay" ? (
        <TranslationOverlay />
      ) : location.hash === "#call-toast" ? (
        <CallToast />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
);
