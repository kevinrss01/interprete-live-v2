import { Hono } from "hono";
import { auth, json, noStore } from "../lib/http";
import { rateLimit } from "../lib/session";
import { voiceMatchSchema } from "../lib/validation";
import { matchVoice } from "../lib/voice-match";

export const voiceMatch = new Hono().post(
  "/voice/match",
  auth,
  json(voiceMatchSchema),
  async (c) => {
    rateLimit(c.var.session.id, "voice-match", 20);
    const { features, language } = c.req.valid("json");
    return c.json(await matchVoice(features, language, c.req.raw.signal), 200, noStore);
  },
);
