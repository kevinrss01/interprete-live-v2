import { Hono } from "hono";
import { z } from "zod";
import { auth, json, noStore } from "../lib/http";
import { createTranscriptionSession } from "../lib/openai";
import { rateLimit } from "../lib/session";
import { languageSchema } from "../lib/validation";

export const session = new Hono().post(
  "/session",
  auth,
  json(z.object({ language: languageSchema })),
  async (c) => {
    rateLimit(c.var.session.id, "session", 20);
    const { language } = c.req.valid("json");
    return c.json(await createTranscriptionSession(language), 200, noStore);
  },
);
