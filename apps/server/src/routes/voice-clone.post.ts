import { Hono } from "hono";
import { auth, noStore } from "../lib/http";
import { cloneVoice } from "../lib/voices";

export const voiceClone = new Hono().post("/voice/clone", auth, async (c) =>
  c.json(await cloneVoice(c.var.session.id, c.req.raw), 200, noStore),
);
