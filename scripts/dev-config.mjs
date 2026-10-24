import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function checkAccountConfig(directory, environment = process.env) {
  let local = {};
  try {
    local = parseEnv(readFileSync(new URL("apps/server/.env.local", directory), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = { ...local, ...environment };
  const validUrl = (value, protocols) => {
    try { return protocols.includes(new URL(value).protocol); }
    catch { return false; }
  };
  const invalid = [];
  if (!validUrl(config.DATABASE_URL, ["postgres:", "postgresql:"])) invalid.push("DATABASE_URL");
  if (!validUrl(config.BETTER_AUTH_URL, ["http:", "https:"])) invalid.push("BETTER_AUTH_URL");
  if ((config.BETTER_AUTH_SECRET?.length ?? 0) < 32) invalid.push("BETTER_AUTH_SECRET");
  if (invalid.length) {
    throw new Error(`Configuration des comptes manquante ou invalide : ${invalid.join(", ")}. `
      + "Complétez apps/server/.env.local à partir de .env.example. "
      + "Générez BETTER_AUTH_SECRET avec openssl rand -base64 32, puis relancez pnpm dev.");
  }
}
