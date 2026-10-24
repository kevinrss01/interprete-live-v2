import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./index";

async function main() {
  try {
    await migrate(getDb(), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    console.log("Database migrations applied.");
  } finally {
    await closeDb();
  }
}

void main().catch(() => {
  console.error("Database migration failed. Check DATABASE_URL and PostgreSQL availability.");
  process.exitCode = 1;
});
