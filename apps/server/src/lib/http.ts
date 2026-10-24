import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import type { z } from "zod";
import { session, type Claims } from "./session";
import { bodyJson, parse } from "./validation";

export const noStore = { "Cache-Control": "no-store" };

// Runs before body validation so a missing session answers 401, not 400.
export const auth = createMiddleware<{ Variables: { session: Claims } }>(
  async (c, next) => {
    c.set("session", session(c.req.raw));
    await next();
  },
);

// Keeps the size limit and French messages of bodyJson/parse; types the RPC client input.
export const json = <T>(schema: z.ZodType<T>) =>
  validator("json", async (_, c) => parse(schema, await bodyJson(c.req)));
