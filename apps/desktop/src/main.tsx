import { Component, StrictMode, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./globals.css";
import { Interpreter } from "./components/interpreter";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <Interpreter />
    </ErrorBoundary>
  </StrictMode>,
);
