import type { ReactNode } from "react";
import { Check } from "lucide-react";

export type OnboardingStep = "profile" | "voice" | "preview";
const STEPS: [OnboardingStep, string][] = [
  ["profile", "Profile"],
  ["voice", "Your voice"],
  ["preview", "Try it"],
];

export function OnboardingHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="onboarding-header">
      <img className="onboarding-logo" src="/logo.png" alt="Interprète" />
      <div className="onboarding-header-action">{action}</div>
    </header>
  );
}

// Floating dock at the bottom: the current step expands into a dark pill.
export function OnboardingStepper({ step }: { step: OnboardingStep }) {
  const at = STEPS.findIndex(([id]) => id === step);
  return (
    <ol className="onboarding-stepper" aria-label="Onboarding steps">
      {STEPS.map(([id, label], i) => (
        <li
          key={id}
          data-state={i < at ? "done" : i === at ? "current" : "next"}
          aria-current={i === at ? "step" : undefined}
        >
          {i === at ? (
            <>
              <b aria-hidden="true">{i + 1}</b>
              {label}
            </>
          ) : (
            <span title={label}>
              {i < at ? <Check size={15} strokeWidth={2.6} aria-hidden="true" /> : i + 1}
              <span className="sr-only">{label}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
