import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

export function releaseConfig({ version, apiUrl }) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Use a stable x.y.z app version.");
  assert.equal(version, version.trim(), "The app version must not contain whitespace.");
  assert(apiUrl, "Set the repository Actions variable VITE_API_URL to the production HTTPS API URL.");
  const url = new URL(apiUrl);
  assert(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
    "VITE_API_URL must be an HTTPS URL without credentials, query or fragment.");
  assert(!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Use a production API host.");
  return { tag: `v${version}` };
}

if (process.argv.includes("--github-output")) {
  const { version } = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
  const { tag } = releaseConfig({ version, apiUrl: process.env.VITE_API_URL });
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
}
