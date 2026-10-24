import { ORPCError, os } from "@orpc/server";
import { getAuth } from "../auth";
import { getDb } from "../db";

export function createContext(headers: Headers) {
  return { headers, auth: getAuth(), db: getDb() };
}

export const protectedProcedure = os
  .$context<ReturnType<typeof createContext>>()
  .use(async ({ context, next }) => {
    const session = await context.auth.api.getSession({ headers: context.headers });
    if (!session) throw new ORPCError("UNAUTHORIZED");
    return next({ context: { user: session.user } });
  });
