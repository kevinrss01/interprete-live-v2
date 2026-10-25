import type { ComponentProps, ReactNode } from "react";
import { Check } from "lucide-react";
import logo from "@interprete/ui/assets/logo.png";
import { Button } from "@interprete/ui/components/button";
import { cn } from "@interprete/ui/lib/utils";

// Voice first, account last: the person hears their voice before filling any form.
export type OnboardingStep = "intro" | "setup" | "voice" | "preview" | "account";
const STEPS: [OnboardingStep, string][] = [
  ["voice", "Your voice"],
  ["preview", "Listen"],
  ["account", "Account"],
];

// Same max width for header and content: past 1280px the layout stops growing.
// The header floats so the content centers on the whole window.
export function OnboardingHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="absolute inset-x-0 top-0 z-1 mx-auto flex w-full max-w-[1280px] items-center justify-between px-12 py-7 max-[860px]:px-6 max-[860px]:py-5">
      {/* The PNG has built-in margins. */}
      <img className="-ml-2.5 block h-14 w-auto" src={logo} alt="Interprète" />
      <div>{action}</div>
    </header>
  );
}

// Floating dock at the bottom, in the page flow so it never covers a button.
export function OnboardingStepper({ step, macSetup = false }: { step: OnboardingStep; macSetup?: boolean }) {
  const steps: [OnboardingStep, string][] = macSetup ? [["setup", "Mac setup"], ...STEPS] : STEPS;
  const at = steps.findIndex(([id]) => id === step);
  return (
    <ol
      className="mb-6 flex items-center gap-1.5 self-center rounded-full border bg-card p-1.5 shadow-lg shadow-foreground/5"
      aria-label="Onboarding steps"
    >
      {steps.map(([id, label], i) => (
        <li
          key={id}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex h-8 items-center gap-2 rounded-full text-[13px] transition-[padding,background-color] duration-300",
            i === at && "bg-muted pr-3.5 pl-1 font-semibold",
          )}
        >
          {i === at ? (
            <>
              <b aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-card text-xs">
                {i + 1}
              </b>
              {label}
            </>
          ) : (
            <span
              title={label}
              className={cn(
                "grid size-8 place-items-center rounded-full font-semibold",
                i < at ? "text-(--ink-2)" : "text-muted-foreground",
              )}
            >
              {i < at ? <Check size={15} strokeWidth={2.6} aria-hidden="true" /> : i + 1}
              <span className="sr-only">{label}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// Page shell shared by the onboarding and the account screens.
export function OnboardingPage({
  action,
  children,
  footer,
  scrollSafe = false,
}: {
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scrollSafe?: boolean;
}) {
  return (
    // One fixed frame the size of the window: screens are designed to fit it, so the
    // page never scrolls. Below the default window size, main scrolls instead of clipping.
    <div className={cn("relative flex h-dvh flex-col overflow-hidden bg-brand-wash", scrollSafe && "mac-setup-page")}>
      <OnboardingHeader action={action} />
      {/* Room for the floating header above; the stepper follows below. */}
      <main className="flex min-h-0 flex-1 items-center justify-center-safe overflow-y-auto px-12 pt-26 pb-6 max-[860px]:px-6 max-[860px]:pt-22 max-[860px]:pb-6">
        {children}
      </main>
      {/* Reserved even when empty (account screens, recording): the centered area keeps its size. */}
      <div className="flex h-17.5 shrink-0 justify-center">{footer}</div>
    </div>
  );
}

// Dev-only controls: dashed, so they never pass for product UI.
export const DevButton = ({ className, ...props }: ComponentProps<typeof Button>) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    className={cn("self-center rounded-full border-dashed bg-transparent text-xs text-muted-foreground", className)}
    {...props}
  />
);
