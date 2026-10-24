"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>La conversation a été interrompue.</h1>
      <p>Rechargez l’interface pour reprendre.</p>
      <button onClick={reset}>Réessayer</button>
    </main>
  );
}
