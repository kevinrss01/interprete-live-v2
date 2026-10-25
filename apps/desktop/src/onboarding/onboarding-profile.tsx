import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { LANGUAGES, type Language } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { Input } from "@interprete/ui/components/input";
import { Label } from "@interprete/ui/components/label";
import { cn } from "@interprete/ui/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@interprete/ui/components/combobox";

export type OnboardingProfileValues = {
  firstName: string;
  email: string;
  password: string;
};
const MIN_PASSWORD = 8; // Better Auth default minPasswordLength

export const systemLanguage = (): Language => {
  const code = navigator.language.slice(0, 2);
  return LANGUAGES.find((l) => l.code === code)?.code ?? "en";
};

// Last step, once the person has heard their voice: one form for the account.
// `onSubmit` resolves with an error message, or null on success.
export function OnboardingProfile({
  hasVoice,
  onSubmit,
  onLogin,
}: {
  hasVoice: boolean; // false after "I don't want to use my voice right now"
  onSubmit: (values: OnboardingProfileValues) => Promise<string | null>;
  onLogin: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSubmit({
      firstName: firstName.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
    setPending(false);
    setError(message);
  }

  return (
    <OnboardingColumns>
      {hasVoice ? (
        <OnboardingIntro title="Your voice is ready." subtitle="Keep it.">
          <p className="mt-5 text-2xl text-(--ink-2)">Create your account to start talking.</p>
        </OnboardingIntro>
      ) : (
        <OnboardingIntro title="One last step." subtitle="Then start talking.">
          <p className="mt-5 text-2xl text-(--ink-2)">You can add your voice later, in Settings.</p>
        </OnboardingIntro>
      )}
      <OnboardingForm onSubmit={create}>
        <OnboardingTitle>Your account</OnboardingTitle>
        <Field label="First name">
          <Input
            className={FIELD}
            required
            autoFocus
            maxLength={40}
            autoComplete="given-name"
            placeholder="Your first name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <Input
            className={FIELD}
            required
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
        <OnboardingError error={error} />
        <Button variant="brand" className={WIDE} type="submit" disabled={pending}>
          {pending ? "Creating your account…" : "Create account"}
          {pending ? <LoaderCircle className="spin absolute right-6" aria-hidden="true" /> : <ArrowEnd />}
        </Button>
        {/* Log in is on the first screen. Here it only shows after a failed sign-up,
            most often an email that already has an account. */}
        {error && (
          <p className="text-center text-[15px] text-muted-foreground">
            Already have an account?{" "}
            <Button type="button" variant="link" className={INLINE_LINK} onClick={onLogin}>
              Log in instead
            </Button>
          </p>
        )}
      </OnboardingForm>
    </OnboardingColumns>
  );
}

// Two columns: the intro on the left, the form on the right (one column when narrow).
// Both are pinned to the top of a fixed-height block, so nothing moves between screens.
export function OnboardingColumns({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)_minmax(320px,460px)] items-start gap-16 max-[860px]:grid-cols-1 max-[860px]:gap-10">
      {children}
    </div>
  );
}

export function OnboardingIntro({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    // Offset that centers the onboarding intro against the form block.
    <section className="pt-28 max-[860px]:pt-0">
      <h1 className="text-[clamp(36px,4.4vw,64px)] leading-[1.12] font-bold tracking-[-0.045em]">
        {title}
        <br />
        <span className="text-muted-foreground">{subtitle}</span>
      </h1>
      {children}
    </section>
  );
}

// Every form and message panel has the height of the tallest one (the account form)
// and keeps a row for "Back", so the title sits at the same place on every screen.
const PANEL = "flex min-h-124 flex-col gap-5.5 max-[860px]:min-h-0";
const BackRow = ({ back }: { back?: ReactNode }) => <div className="-mb-3.5 h-8">{back}</div>;
export const OnboardingForm = ({ back, children, ...props }: ComponentProps<"form"> & { back?: ReactNode }) => (
  <form className={cn(PANEL, STEP_IN)} {...props}>
    <BackRow back={back} />
    {children}
  </form>
);
export const OnboardingPanel = ({ back, children }: { back?: ReactNode; children: ReactNode }) => (
  <div className={cn(PANEL, STEP_IN)}>
    <BackRow back={back} />
    {children}
  </div>
);
export const OnboardingTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="text-[40px] font-bold tracking-[-0.035em]">{children}</h2>
);
export const OnboardingError = ({ error }: { error: string | null }) =>
  error && (
    <p className="mb-3 text-[15px] text-destructive" role="alert">
      {error}
    </p>
  );
// Arrow pinned to the right edge of a full-width button.
export const ArrowEnd = () => <ArrowRight className="absolute right-6" aria-hidden="true" />;
export const INLINE_LINK = "h-auto p-0 text-[length:inherit] font-medium text-foreground underline underline-offset-3";
export const BACK = "-ml-2.5 text-[15px] text-(--ink-2)";
export const WIDE = "relative h-14 w-full text-[17px] font-semibold";
export const FIELD = "h-12.5 bg-card px-4.5 text-[17px] md:text-[17px]";
// Fade used when a step or a part of a step appears (reduced motion is handled globally).
export const STEP_IN = "animate-in fade-in duration-300";

// Flag shown before each language: the country most associated with it.
const LANGUAGE_COUNTRY: Record<Language, string> = {
  fr: "FR", en: "GB", es: "ES", de: "DE", it: "IT", pt: "PT", nl: "NL", ja: "JP", ko: "KR",
  zh: "CN", ar: "SA", hi: "IN", pl: "PL", ru: "RU", sv: "SE", tr: "TR", uk: "UA", vi: "VN",
};
// Regional indicator letters render as the country's flag emoji.
const flag = (country: string) =>
  String.fromCodePoint(...[...country].map((c) => 0x1f1a5 + c.charCodeAt(0)));
const englishName = new Intl.DisplayNames(["en"], { type: "language" });
// The interface is in English, so language names in sentences are too ("speak Spanish").
export const englishLanguage = (code: Language) => englishName.of(code) ?? code;
type LanguageOption = { code: Language; label: string; flag: string; search: string };
const LANGUAGE_OPTIONS: LanguageOption[] = LANGUAGES.map((l) => {
  const english = englishName.of(l.code) ?? l.code;
  return {
    code: l.code,
    label: english,
    flag: flag(LANGUAGE_COUNTRY[l.code]),
    // Native and English names: "Japanese" and "日本語" both match.
    search: `${l.native} ${english} ${l.name}`.toLowerCase(),
  };
});

// Searchable language list (shadcn Combobox) that looks like the other fields.
export function LanguagePicker({
  value,
  onChange,
  label,
  className,
}: {
  value: Language;
  onChange: (language: Language) => void;
  label?: string; // accessible name when there is no visible <label>
  className?: string;
}) {
  return (
    <Combobox
      items={LANGUAGE_OPTIONS}
      value={LANGUAGE_OPTIONS.find((o) => o.code === value)}
      onValueChange={(option) => option && onChange(option.code)}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.code === b.code}
      filter={(option, query) => option.search.includes(query.trim().toLowerCase())}
    >
      <ComboboxTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            className={cn(FIELD, "w-full justify-between font-normal hover:bg-card", className)}
          />
        }
      >
        <ComboboxValue>
          {(option: LanguageOption) => (
            <span className="flex items-center gap-3">
              <span aria-hidden="true">{option.flag}</span>
              {option.label}
            </span>
          )}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent className="min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder="Search a language" />
        <ComboboxEmpty>No language found.</ComboboxEmpty>
        <ComboboxList>
          {(option: LanguageOption) => (
            <ComboboxItem key={option.code} value={option} className="gap-3 py-2 text-[15px]">
              <span aria-hidden="true">{option.flag}</span>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Label className="flex-col items-stretch gap-2.5 leading-normal font-normal select-auto">
      <span className="text-base font-semibold">{label}</span>
      {children}
      {hint && <small className="text-sm text-muted-foreground">{hint}</small>}
    </Label>
  );
}

// The length uses native validation; the eye button replaces a confirmation field.
export function PasswordInput({
  value,
  onChange,
  placeholder,
  login = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  id?: string; // for a <Label htmlFor> outside <Field>
  login?: boolean; // an existing password: no length rule, current-password autofill
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <Input
        id={id}
        className={cn(FIELD, "pr-13")}
        required
        type={shown ? "text" : "password"}
        minLength={login ? undefined : MIN_PASSWORD}
        maxLength={128}
        autoComplete={login ? "current-password" : "new-password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={() => setShown(!shown)}
        aria-label={shown ? "Hide password" : "Show password"}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </span>
  );
}
