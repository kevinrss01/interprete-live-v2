import { Component, type ReactNode } from "react";
import { Button } from "@interprete/ui/components/button";

export class ErrorBoundary extends Component<{ children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-page">
        <h1>The conversation was interrupted.</h1>
        <p>Reload the interface to continue.</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </main>
    );
  }
}
