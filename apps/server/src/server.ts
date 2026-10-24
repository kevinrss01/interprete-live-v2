import { serve } from "@hono/node-server";
import { app } from "./app";
import { closeDb } from "./db";

const port = Number(process.env.PORT) || 3035;
const server = serve({ fetch: app.fetch, port }, ({ port }) =>
  console.log(`API listening on :${port}`),
);
// Let in-flight SSE responses finish when Docker stops the container.
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => {
    void closeDb().then(() => process.exit(0), () => process.exit(1));
  }));
