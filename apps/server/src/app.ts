import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import { configurationStatus, MODELS } from "./lib/config";
import { AppError, errorResponse } from "./lib/errors";
import { interpretResponse } from "./lib/interpret";
import { createTranscriptionSession } from "./lib/openai";
import {
  allowedOrigin,
  bootstrapSession,
  rateLimit,
  resolveVoice,
  session,
  type Claims,
} from "./lib/session";
import {
  bodyJson,
  interpretSchema,
  languageSchema,
  parse,
} from "./lib/validation";
import { cloneVoice, deleteVoice } from "./lib/voices";

const noStore = { "Cache-Control": "no-store" };
// Runs before body validation so a missing session answers 401, not 400.
const auth = createMiddleware<{ Variables: { session: Claims } }>(
  async (c, next) => {
    c.set("session", session(c.req.raw));
    await next();
  },
);
// Keeps the size limit and French messages of bodyJson/parse; types the RPC client input.
const json = <T>(schema: z.ZodType<T>) =>
  validator("json", async (_, c) => parse(schema, await bodyJson(c.req)));

export const app = new Hono()
  .use(logger())
  .use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  })
  .use(
    "/api/*",
    cors({
      // The desktop app runs on tauri://localhost, so every call is cross-origin.
      origin: (origin) => (allowedOrigin(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  )
  .get("/api/status", (c) => {
    const { token } = bootstrapSession(c.req.raw);
    return c.json(
      { services: configurationStatus(), models: MODELS, session: token },
      200,
      noStore,
    );
  })
  .post(
    "/api/session",
    auth,
    json(z.object({ language: languageSchema })),
    async (c) => {
      rateLimit(c.var.session.id, "session", 20);
      const { language } = c.req.valid("json");
      return c.json(await createTranscriptionSession(language), 200, noStore);
    },
  )
  .post("/api/interpret", auth, json(interpretSchema), (c) => {
    const s = c.var.session;
    rateLimit(s.id, "interpret", 120);
    const data = c.req.valid("json");
    const voiceId = resolveVoice(data.voice, s.id, data.speaker);
    return interpretResponse(data, voiceId, c.req.raw.signal);
  })
  .post("/api/voice/clone", auth, async (c) =>
    c.json(await cloneVoice(c.var.session.id, c.req.raw), 200, noStore),
  )
  .post(
    "/api/voice/delete",
    auth,
    json(
      z.object({ voice: z.string().max(1000), speaker: z.enum(["a", "b"]) }),
    ),
    async (c) => {
      const { voice, speaker } = c.req.valid("json");
      await deleteVoice(c.var.session.id, voice, speaker);
      return c.json({ deleted: true }, 200, noStore);
    },
  )
  .notFound(() =>
    errorResponse(new AppError("NOT_FOUND", "Cette route n’existe pas.", 404)),
  )
  .onError((e) =>
    errorResponse(
      e instanceof HTTPException
        ? new AppError("PAYLOAD", "La demande est illisible.", e.status)
        : e,
    ),
  );

export type AppType = typeof app;
