import { Hono } from "hono";
import { configurationStatus, MODELS } from "../lib/config";
import { noStore } from "../lib/http";
import { bootstrapSession } from "../lib/session";

export const status = new Hono().get("/status", (c) => {
  const { token } = bootstrapSession(c.req.raw);
  return c.json(
    { services: configurationStatus(), models: MODELS, session: token },
    200,
    noStore,
  );
});
