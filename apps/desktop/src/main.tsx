import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { App } from "./components/app";
import { CallToast } from "./windows/call-toast";
import { ErrorBoundary } from "./components/error-boundary";
import { TranslationOverlay } from "./windows/translation-overlay";

function Root() {
  if (location.hash === "#translation-overlay") return <TranslationOverlay />;
  if (location.hash === "#call-toast") return <CallToast />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
