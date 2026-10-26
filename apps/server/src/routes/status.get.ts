import { Hono } from "hono";
import { configurationStatus, MODELS } from "../lib/config";
import { noStore } from "../lib/http";
import { bootstrapSession } from "../lib/session";

export const status = new Hono().get("/status", (c) => {
  const { token } = bootstrapSession(c.req.raw);
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const revision = sha && /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
  return c.json(
    { services: configurationStatus(), models: MODELS, session: token, revision },
    200,
    noStore,
  );
});
