import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiClient } from "@interprete/server/rpc";

const API_URL = import.meta.env?.VITE_API_URL ?? "";
const TOKEN_KEY = "interprete-auth-token";

// Better Auth session token, sent as Bearer (cookies don't cross tauri://localhost).
// Separate from the anonymous interpreter session ("interprete-session").
// ponytail: webview localStorage; move to the macOS keychain with a Tauri plugin later.
export const readAuthToken = () => globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;

export function signOut() {
  globalThis.localStorage?.removeItem(TOKEN_KEY);
}

// Typed oRPC client: account.me, preferences.get, preferences.update.
export const rpc: ApiClient = createORPCClient(
  new RPCLink({
    url: `${API_URL}/rpc`,
    headers: (): Record<string, string> => {
      const token = readAuthToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  }),
);

const AUTH_ERRORS: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "Account creation and sign-in are unavailable: the server’s authentication is not configured.",
  DATABASE_NOT_CONFIGURED: "Account creation and sign-in are unavailable: the server’s database is not configured.",
  USER_ALREADY_EXISTS: "This email is already used. Use another one.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "This email is already used. Use another one.",
  INVALID_EMAIL: "Enter a valid email.",
  INVALID_EMAIL_OR_PASSWORD: "Wrong email or password.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "Use at most 128 characters for your password.",
};

// Calls a Better Auth email endpoint and keeps the session token it returns.
async function authenticate(path: string, input: object, fallback: string) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Can’t reach the server. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string; token?: string | null };
  if (!response.ok) throw new Error(AUTH_ERRORS[body.code ?? ""] ?? fallback);
  const token = response.headers.get("set-auth-token") ?? body.token;
  if (!token) throw new Error(fallback);
  localStorage.setItem(TOKEN_KEY, token);
}

// Email + password sign-up. The email is the unique key of an account.
export const signUp = (input: { name: string; email: string; password: string }) =>
  authenticate("/sign-up/email", input, "Your account could not be created. Try again.");

export const signIn = (input: { email: string; password: string }) =>
  authenticate("/sign-in/email", input, "You could not be logged in. Try again.");
