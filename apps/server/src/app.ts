import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { RPCHandler } from "@orpc/server/fetch";
import { getAuth } from "./auth";
import { AppError, errorResponse } from "./lib/errors";
import { allowedOrigin, checkOrigin } from "./lib/session";
import { status } from "./routes/status.get";
import { session } from "./routes/session.post";
import { interpret } from "./routes/interpret.post";
import { voiceClone } from "./routes/voice-clone.post";
import { voiceDelete } from "./routes/voice-delete.post";
import { voicePreview } from "./routes/voice-preview.post";
import { voiceMatch } from "./routes/voice-match.post";
import { createContext } from "./rpc/base";
import { router } from "./rpc/router";

const rpc = new RPCHandler(router);
const payloadLimit = bodyLimit({ maxSize: 25_000 });

export const app = new Hono()
  .use(logger())
  .use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  })
  .use("*", cors({
    origin: (origin) => (allowedOrigin(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-token"],
    credentials: true,
    maxAge: 600,
  }))
  .use("/api/auth/*", payloadLimit)
  .on(["GET", "POST"], "/api/auth/*", (c) => {
    c.header("Cache-Control", "no-store");
    return getAuth().handler(c.req.raw);
  })
  .use("/rpc/*", payloadLimit)
  .use("/rpc/*", async (c, next) => {
    checkOrigin(c.req.raw);
    c.header("Cache-Control", "no-store");
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/rpc",
      context: createContext(c.req.raw.headers),
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  })
  .route("/api", status)
  .route("/api", session)
  .route("/api", interpret)
  .route("/api", voiceClone)
  .route("/api", voiceDelete)
  .route("/api", voicePreview)
  .route("/api", voiceMatch)
  .notFound(() =>
    errorResponse(new AppError("NOT_FOUND", "This route does not exist.", 404)),
  )
  .onError((e) =>
    errorResponse(
      e instanceof HTTPException
        ? new AppError("PAYLOAD", "The request could not be read.", e.status)
        : e,
    ),
  );

export type AppType = typeof app;

// Vercel's Hono runtime loads this app without starting the standalone server.
export default app;
