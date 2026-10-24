import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { LANGUAGES, type Language } from "@interprete/shared/languages";
import { rpc, signIn } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { saveOnboardingAccount } from "../onboarding/onboarding-account";
import { OnboardingHeader } from "../onboarding/onboarding-header";
import { Field, PasswordInput } from "../onboarding/onboarding-profile";
import "../onboarding/onboarding.css";

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
    <div className="onboarding">
      <OnboardingHeader />
      <main className="onboarding-main">
        {screen === "login" && (
          <Login controller={controller} onForgot={() => onNavigate("forgot")} onSignUp={onSignUp} onSignedIn={onSignedIn} />
        )}
        {screen === "forgot" && <Forgot onBack={() => onNavigate("login")} onReset={() => onNavigate("reset")} />}
        {screen === "reset" && <Reset onDone={() => onNavigate("login")} />}
      </main>
    </div>
  );
}

function Layout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="onboarding-profile">
      <section className="onboarding-intro">
        <h1>
          {title}
          <br />
          <em>{subtitle}</em>
        </h1>
      </section>
      {children}
    </div>
  );
}

function Submit({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <button className="onboarding-primary onboarding-wide" type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
      {pending ? (
        <LoaderCircle size={18} className="spin" aria-hidden="true" />
      ) : (
        <ArrowRight size={18} aria-hidden="true" />
      )}
    </button>
  );
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error && (
    <p className="onboarding-error" role="alert">
      {error}
    </p>
  );

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
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "You could not be logged in. Try again.");
      setPending(false);
    }
  }

  return (
    <Layout title="Welcome back." subtitle="Your voice is waiting.">
      <form className="onboarding-form" onSubmit={submit}>
        <h2>Log in</h2>
        <Field label="Email">
          <input
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
        <Field label="Password">
          <PasswordInput login value={password} onChange={setPassword} placeholder="Your password" />
        </Field>
        <button type="button" className="onboarding-quiet onboarding-inline-link" onClick={onForgot}>
          Forgot password?
        </button>
        <ErrorLine error={error} />
        <Submit pending={pending} label="Log in" pendingLabel="Logging in…" />
        <p className="onboarding-switch">
          New here?{" "}
          <button type="button" className="onboarding-quiet onboarding-inline-link" onClick={onSignUp}>
            Create an account
          </button>
        </p>
      </form>
    </Layout>
  );
}

// ponytail: no email is sent yet (Better Auth needs sendResetPassword and an email
// provider). The page shows the expected flow; in dev a link opens the reset page.
function Forgot({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Layout title="It happens." subtitle="Let’s get you back in.">
      {sent ? (
        <div className="onboarding-form">
          <h2>Check your email</h2>
          <p className="onboarding-lead">
            If an account exists for <b>{email}</b>, you’ll get a link to choose a new password.
          </p>
          <button type="button" className="onboarding-primary onboarding-wide" onClick={onBack}>
            Back to log in
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {import.meta.env.DEV && (
            <button type="button" className="onboarding-dev" onClick={onReset}>
              Dev: open the reset page
            </button>
          )}
        </div>
      ) : (
        <form
          className="onboarding-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <button type="button" className="onboarding-quiet onboarding-back" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          <h2>Forgot password</h2>
          <p className="onboarding-lead">Enter your email. We’ll send you a link to reset your password.</p>
          <Field label="Email">
            <input
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
        </form>
      )}
    </Layout>
  );
}

// ponytail: reached from the email link once emails exist; it will then send
// the link's token to Better Auth (/reset-password). For now nothing is saved.
function Reset({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <Layout title="Almost there." subtitle="Pick a new password.">
      {done ? (
        <div className="onboarding-form">
          <h2>Password updated</h2>
          <p className="onboarding-lead">You can now log in with your new password.</p>
          <button type="button" className="onboarding-primary onboarding-wide" onClick={onDone}>
            Log in
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <form
          className="onboarding-form"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(true);
          }}
        >
          <h2>Reset password</h2>
          <Field label="New password">
            <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" />
          </Field>
          <Field
            label="Confirm password"
            hint={mismatch && <span className="onboarding-invalid">The passwords don’t match.</span>}
          >
            <PasswordInput value={confirm} onChange={setConfirm} mismatch={mismatch} placeholder="Type it again" />
          </Field>
          <Submit pending={false} label="Update password" pendingLabel="" />
        </form>
      )}
    </Layout>
  );
}
