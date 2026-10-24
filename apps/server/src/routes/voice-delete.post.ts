import { Hono } from "hono";
import { z } from "zod";
import { auth, json, noStore } from "../lib/http";
import { deleteVoice } from "../lib/voices";

export const voiceDelete = new Hono().post(
  "/voice/delete",
  auth,
  json(z.object({ voice: z.string().max(1000), speaker: z.enum(["a", "b"]) })),
  async (c) => {
    const { voice, speaker } = c.req.valid("json");
    await deleteVoice(c.var.session.id, voice, speaker);
    return c.json({ deleted: true }, 200, noStore);
  },
);
