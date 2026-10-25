import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function publishDownload({ file, secret, fetchImpl = fetch }) {
  assert(secret, "Set the repository Actions secret DOWNLOAD_PUBLISH_SECRET.");
  const body = await readFile(file);
  assert(body.length > 512 && body.subarray(-512, -508).toString() === "koly", "Expected a complete macOS DMG file.");
  const authorization = await fetchImpl("https://tryinterprete.com/api/publish-download", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(authorization.ok, `Download authorization failed (${authorization.status}).`);
  const { uploadUrl } = await authorization.json();
  const url = new URL(uploadUrl);
  assert(url.origin === "https://vercel.com" && url.pathname === "/api/blob/" && !url.username && !url.password,
    "Unexpected upload destination.");
  const upload = await fetchImpl(url, {
    method: "PUT",
    headers: { "Content-Type": "application/x-apple-diskimage", "x-content-type": "application/x-apple-diskimage" },
    redirect: "error",
    body,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  assert(upload.ok, `Public DMG upload failed (${upload.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishDownload({ file: process.argv[2], secret: process.env.DOWNLOAD_PUBLISH_SECRET });
  console.log("Public macOS download updated.");
}
