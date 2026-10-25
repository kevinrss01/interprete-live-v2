import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { z } from "zod";
import { getDb } from "./db";
import { account, session, user, verification } from "./db/schema";
import { AppError } from "./lib/errors";
import { allowedOrigins } from "./lib/session";

let auth: ReturnType<typeof createAuth> | undefined;

function createAuth() {
  const config = z.object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  }).safeParse(process.env);
  if (!config.success)
    throw new AppError("AUTH_NOT_CONFIGURED", "Configure BETTER_AUTH_URL and BETTER_AUTH_SECRET (at least 32 characters).", 503);

  return betterAuth({
    appName: "Interprète",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    trustedOrigins: allowedOrigins,
    plugins: [bearer()],
    // Email + password for now; the email is the unique key. No verification yet.
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: true },
  });
}

export function getAuth() {
  return auth ??= createAuth();
}
