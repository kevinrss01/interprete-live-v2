import { LANGUAGES, type Language } from "@interprete/shared/languages";

export type OnboardingAccount = {
  firstName: string;
  email: string;
  language: Language;
  complete: boolean;
};
const storageKey = "interprete-account-v1";

// ponytail: phase 1 keeps the account on this device. Phase 2 creates it on the
// server (POST /api/account) and answers "email already used" from there.
export function loadOnboardingAccount(): OnboardingAccount | null {
  try {
    const a = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      typeof a?.firstName === "string" &&
      typeof a.email === "string" &&
      LANGUAGES.some((l) => l.code === a.language)
    )
      return { ...a, complete: a.complete === true };
  } catch {}
  return null;
}

export function saveOnboardingAccount(account: OnboardingAccount) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(account));
  } catch {}
}
