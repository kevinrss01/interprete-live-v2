import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { LANGUAGES, type Language } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { Input } from "@interprete/ui/components/input";
import { Label } from "@interprete/ui/components/label";
import { rpc, signIn } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { saveOnboardingAccount } from "./onboarding-account";
import { DevButton } from "./onboarding-header";
import {
  ArrowEnd,
  BACK,
  FIELD,
  Field,
  INLINE_LINK,
  OnboardingColumns,
  OnboardingError,
  OnboardingForm,
  OnboardingIntro,
  OnboardingPanel,
  OnboardingTitle,
  PasswordInput,
  WIDE,
} from "./onboarding-profile";

export type AuthScreen = "login" | "forgot" | "reset";

// Log in, forgot password and reset password, in the onboarding's look.
export function Auth({
  screen,
  controller,
  onNavigate,
  onSignUp,
  onSignedIn,
}: {
  screen: AuthScreen;
  controller: InterpreterController;
  onNavigate: (screen: AuthScreen) => void;
  onSignUp: () => void;
  onSignedIn: () => void;
}) {
  return (
    <>
      {screen === "login" && (
        <Login controller={controller} onForgot={() => onNavigate("forgot")} onSignUp={onSignUp} onSignedIn={onSignedIn} />
      )}
      {screen === "forgot" && <Forgot onBack={() => onNavigate("login")} onReset={() => onNavigate("reset")} />}
      {screen === "reset" && <Reset onDone={() => onNavigate("login")} />}
    </>
  );
}

function Layout({
  title,
  subtitle,
  lead,
  children,
}: {
  title: string;
  subtitle: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <OnboardingColumns>
      <OnboardingIntro title={title} subtitle={subtitle}>
        <p className="mt-5 text-2xl text-(--ink-2)">{lead}</p>
      </OnboardingIntro>
      {children}
    </OnboardingColumns>
  );
}

function Submit({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button variant="brand" className={WIDE} type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
      {pending ? <LoaderCircle className="spin absolute right-6" aria-hidden="true" /> : <ArrowEnd />}
    </Button>
  );
}


function Login({
  controller,
  onForgot,
  onSignUp,
  onSignedIn,
}: {
  controller: InterpreterController;
  onForgot: () => void;
  onSignUp: () => void;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn({ email: email.trim().toLowerCase(), password });
      // Restore the profile saved on the account, so the app opens as this person.
      const [me, preferences] = await Promise.all([
        rpc.account.me(),
        rpc.preferences.get().catch(() => null),
      ]);
      const saved = preferences?.sourceLanguage;
      const language: Language = LANGUAGES.find((l) => l.code === saved)?.code ?? "en";
      saveOnboardingAccount({ firstName: me.name, email: me.email, language, complete: true });
      controller.setProfile("a", { name: me.name, language });
      const savedTarget = LANGUAGES.find((l) => l.code === preferences?.targetLanguage)?.code;
      const current = controller.getSnapshot().profiles.b.language;
      // The two speakers need different languages, as during onboarding.
      const target = savedTarget ?? (current !== language ? current : language === "en" ? "fr" : "en");
      controller.setProfile("b", { language: target });
      await controller.syncAccountVoice();
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "You could not be logged in. Try again.");
      setPending(false);
    }
  }

  return (
    <Layout title="Welcome back." subtitle="Your voice is waiting." lead="Use your email and password.">
      <OnboardingForm onSubmit={submit}>
        <OnboardingTitle>Log in</OnboardingTitle>
        <Field label="Email">
          <Input
            className={FIELD}
            required
            autoFocus
            type="email"
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {/* Not a <Field>: a button inside the <label> would take its labeling. */}
        <div className="flex flex-col gap-2.5">
          <span className="flex items-center justify-between">
            <Label htmlFor="login-password" className="text-base font-semibold">
              Password
            </Label>
            <Button type="button" variant="link" className={`${INLINE_LINK} text-sm text-(--ink-2)`} onClick={onForgot}>
              Forgot password?
            </Button>
          </span>
          <PasswordInput id="login-password" login value={password} onChange={setPassword} placeholder="Your password" />
        </div>
        <OnboardingError error={error} />
        <Submit pending={pending} label="Log in" pendingLabel="Logging in…" />
        <p className="text-center text-[15px] text-muted-foreground">
          New here?{" "}
          <Button type="button" variant="link" className={INLINE_LINK} onClick={onSignUp}>
            Create an account
          </Button>
        </p>
      </OnboardingForm>
    </Layout>
  );
}

// ponytail: no email is sent yet (Better Auth needs sendResetPassword and an email
// provider). The page shows the expected flow; in dev a link opens the reset page.
function Forgot({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Layout title="It happens." subtitle="Let’s get you back in." lead="We’ll send a link to your email.">
      {sent ? (
        <OnboardingPanel>
          <OnboardingTitle>Check your email</OnboardingTitle>
          <p className="-mt-2 text-base text-(--ink-2)">
            If an account exists for <b>{email}</b>, you’ll get a link to choose a new password.
          </p>
          <Button type="button" variant="brand" className={WIDE} onClick={onBack}>
            Back to log in
            <ArrowEnd />
          </Button>
          {import.meta.env.DEV && (
            <DevButton onClick={onReset}>Dev: open the reset page</DevButton>
          )}
        </OnboardingPanel>
      ) : (
        <OnboardingForm
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
          back={
            <Button type="button" variant="ghost" className={BACK} onClick={onBack}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          }
        >
          <OnboardingTitle>Forgot password</OnboardingTitle>
          <p className="-mt-2 text-base text-(--ink-2)">Enter your email. We’ll send you a link to reset your password.</p>
          <Field label="Email">
            <Input
              className={FIELD}
              required
              autoFocus
              type="email"
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
            />
          </Field>
          <Submit pending={false} label="Send reset link" pendingLabel="" />
        </OnboardingForm>
      )}
    </Layout>
  );
}

// ponytail: reached from the email link once emails exist; it will then send
// the link's token to Better Auth (/reset-password). For now nothing is saved.
function Reset({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Layout title="Almost there." subtitle="Pick a new password." lead="Choose something you haven’t used here.">
      {done ? (
        <OnboardingPanel>
          <OnboardingTitle>Password updated</OnboardingTitle>
          <p className="-mt-2 text-base text-(--ink-2)">You can now log in with your new password.</p>
          <Button type="button" variant="brand" className={WIDE} onClick={onDone}>
            Log in
            <ArrowEnd />
          </Button>
        </OnboardingPanel>
      ) : (
        <OnboardingForm
          onSubmit={(e) => {
            e.preventDefault();
            setDone(true);
          }}
        >
          <OnboardingTitle>Reset password</OnboardingTitle>
          <Field label="New password">
            <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" />
          </Field>
          <Submit pending={false} label="Update password" pendingLabel="" />
        </OnboardingForm>
      )}
    </Layout>
  );
}
