import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { applyTheme, loadTheme } from "./lib/theme";

applyTheme(loadTheme());
import { App } from "./components/app";
import { WindowScrollbar } from "./components/window-scrollbar";
import { CallToast } from "./windows/call-toast";
import { CallCaptions } from "./windows/call-captions";
import { ErrorBoundary } from "./components/error-boundary";
import { TranslationOverlay } from "./windows/translation-overlay";

function Root() {
  if (location.hash === "#translation-overlay") return <TranslationOverlay />;
  if (location.hash === "#call-toast") return <CallToast />;
  if (location.hash === "#call-captions") return <CallCaptions />;
  return (
    <>
      <App />
      <WindowScrollbar />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
