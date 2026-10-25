import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { userVoice } from "../db/schema";
import { verify, voiceGrant } from "../lib/session";
import { protectedProcedure } from "./base";

// The device session token (`interprete-session`), sent in the body: the RPC
// Authorization header carries the account token instead.
const deviceSession = z.string().max(1000);

function sessionId(token: string) {
  const claims = verify(token);
  if (claims?.purpose !== "session") throw new ORPCError("BAD_REQUEST", { message: "Reload the app to start a new session." });
  return claims.id;
}

// Returns speaker A's saved voice as a grant for the current device session.
export const get = protectedProcedure
  .input(z.object({ session: deviceSession }))
  .output(z.object({ voice: z.string() }).nullable())
  .handler(async ({ context, input }) => {
    const id = sessionId(input.session);
    const [saved] = await context.db.select({ voiceId: userVoice.voiceId })
      .from(userVoice).where(eq(userVoice.userId, context.user.id));
    return saved ? { voice: voiceGrant(id, "a", saved.voiceId) } : null;
  });

// Saves speaker A's cloned voice on the account. The grant must belong to the
// caller's device session, so a voice id can't be attached from elsewhere.
export const save = protectedProcedure
  .input(z.object({ session: deviceSession, voice: z.string().max(1000) }))
  .output(z.object({ saved: z.boolean() }))
  .handler(async ({ context, input }) => {
    const grant = verify(input.voice);
    if (grant?.purpose !== "voice" || grant.speaker !== "a" || !grant.voiceId || grant.id !== sessionId(input.session))
      throw new ORPCError("FORBIDDEN", { message: "This voice cannot be saved on the account." });
    await context.db.insert(userVoice)
      .values({ userId: context.user.id, voiceId: grant.voiceId })
      .onConflictDoUpdate({ target: userVoice.userId, set: { voiceId: grant.voiceId } });
    return { saved: true };
  });

export const remove = protectedProcedure
  .output(z.object({ removed: z.boolean() }))
  .handler(async ({ context }) => {
    await context.db.delete(userVoice).where(eq(userVoice.userId, context.user.id));
    return { removed: true };
  });
