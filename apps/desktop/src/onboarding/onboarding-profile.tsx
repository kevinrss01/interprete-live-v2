import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { LANGUAGES, type Language } from "@interprete/shared/languages";

export type OnboardingProfileValues = {
  language: Language;
  firstName: string;
  email: string;
  password: string;
};
const MIN_PASSWORD = 8; // Better Auth default minPasswordLength

const systemLanguage = (): Language => {
  const code = navigator.language.slice(0, 2);
  return LANGUAGES.find((l) => l.code === code)?.code ?? "en";
};

// Step 1 in two short parts: about you (first name, language), then the account
// (email, password). `onSubmit` resolves with an error message, or null on success.
export function OnboardingProfile({
  onSubmit,
  onLogin,
}: {
  onSubmit: (values: OnboardingProfileValues) => Promise<string | null>;
  onLogin: () => void;
}) {
  const [part, setPart] = useState<1 | 2>(1);
  const [language, setLanguage] = useState<Language>(systemLanguage);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function create(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSubmit({
      language,
      firstName: firstName.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
    setPending(false);
    setError(message);
  }

  return (
    <div className="onboarding-profile">
      <section className="onboarding-intro">
        <h1>
          All your languages.
          <br />
          <em>Always your voice.</em>
        </h1>
        <p>Let’s get to know each other.</p>
      </section>
      {part === 1 ? (
        <form
          className="onboarding-form"
          onSubmit={(e) => {
            e.preventDefault();
            setPart(2);
          }}
        >
          <h2>About you</h2>
          <Field label="First name">
            <input
              required
              autoFocus
              maxLength={40}
              autoComplete="given-name"
              placeholder="Your first name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label="Your language" hint="You’ll read a short text in this language.">
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native}
                </option>
              ))}
            </select>
          </Field>
          <button className="onboarding-primary onboarding-wide" type="submit">
            Continue
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className="onboarding-switch">
            Already have an account?{" "}
            <button type="button" className="onboarding-quiet onboarding-inline-link" onClick={onLogin}>
              Log in
            </button>
          </p>
        </form>
      ) : (
        <form className="onboarding-form" onSubmit={create}>
          <button
            type="button"
            className="onboarding-quiet onboarding-back"
            onClick={() => setPart(1)}
            disabled={pending}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          <h2>Your account</h2>
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
            <PasswordInput value={password} onChange={setPassword} placeholder={`At least ${MIN_PASSWORD} characters`} />
          </Field>
          <Field
            label="Confirm password"
            hint={mismatch && <span className="onboarding-invalid">The passwords don’t match.</span>}
          >
            <PasswordInput value={confirm} onChange={setConfirm} mismatch={mismatch} placeholder="Type it again" />
          </Field>
          {error && (
            <p className="onboarding-error" role="alert">
              {error}
            </p>
          )}
          <button className="onboarding-primary onboarding-wide" type="submit" disabled={pending}>
            {pending ? "Creating your account…" : "Create account"}
            {pending ? (
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
            ) : (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </button>
        </form>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="onboarding-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// Length and confirmation use native validation, so the form can't be sent until both pass.
export function PasswordInput({
  value,
  onChange,
  placeholder,
  mismatch = false,
  login = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  mismatch?: boolean;
  login?: boolean; // an existing password: no length rule, current-password autofill
}) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.setCustomValidity(mismatch ? "The passwords don’t match." : ""), [mismatch]);
  return (
    <span className="onboarding-password">
      <input
        ref={input}
        required
        type={shown ? "text" : "password"}
        minLength={login ? undefined : MIN_PASSWORD}
        maxLength={128}
        autoComplete={login ? "current-password" : "new-password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={mismatch || undefined}
      />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"}>
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  );
}
