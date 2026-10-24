import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export class ErrorBoundary extends Component<{ children: ReactNode }> {
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
        <Button onClick={() => location.reload()}>Réessayer</Button>
      </main>
    );
  }
}
