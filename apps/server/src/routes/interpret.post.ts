import { Hono } from "hono";
import { auth, json } from "../lib/http";
import { interpretResponse } from "../lib/interpret";
import { rateLimit, resolveVoice } from "../lib/session";
import { interpretSchema } from "../lib/validation";

export const interpret = new Hono().post("/interpret", auth, json(interpretSchema), (c) => {
  const s = c.var.session;
  rateLimit(s.id, "interpret", 120);
  const data = c.req.valid("json");
  const voiceId =
    data.speak === false ? null : resolveVoice(data.voice, s.id, data.speaker);
  return interpretResponse(data, voiceId, c.req.raw.signal);
});
