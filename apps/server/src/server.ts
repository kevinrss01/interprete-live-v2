import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.PORT) || 3035;
const server = serve({ fetch: app.fetch, port }, ({ port }) =>
  console.log(`API listening on :${port}`),
);
// Let in-flight SSE responses finish when Docker stops the container.
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
