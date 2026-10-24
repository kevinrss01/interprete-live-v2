import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../lib/errors";
import * as schema from "./schema";

let database: ReturnType<typeof connect> | undefined;

function connect() {
  const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
  if (!url.success)
    throw new AppError("DATABASE_NOT_CONFIGURED", "DATABASE_URL doit être configurée.", 503);
  const pool = new Pool({ connectionString: url.data, connectionTimeoutMillis: 5000 });
  pool.on("error", () => console.error("PostgreSQL connection failed"));
  return drizzle(pool, { schema });
}

// Keep the existing audio API usable before account storage is configured.
export function getDb() {
  return database ??= connect();
}

export async function closeDb() {
  if (database) await database.$client.end();
  database = undefined;
}
