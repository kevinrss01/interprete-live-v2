import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishDownload } from "./publish-download.mjs";

test("publication validates the DMG, authorizes, then uploads directly to storage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "interprete-download-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "test.dmg");
  const dmg = Buffer.alloc(1024);
  dmg.write("koly", 512);
  await writeFile(file, dmg);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? Response.json({ uploadUrl: "https://vercel.com/api/blob/?signed=test" }) : new Response("{}", { status: 200 });
  };
  await publishDownload({ file, secret: "test-secret", fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://tryinterprete.com/api/publish-download");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-secret");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(calls[1].options.body, dmg);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers["x-content-type"], "application/x-apple-diskimage");

  await assert.rejects(publishDownload({ file, secret: "" }), /Actions secret/);
  await assert.rejects(publishDownload({ file, secret: "test-secret", fetchImpl: async () => new Response(null, { status: 401 }) }), /authorization failed/);
  await assert.rejects(publishDownload({ file, secret: "test-secret", fetchImpl: async () => Response.json({ uploadUrl: "https://example.com/upload" }) }), /Unexpected upload/);
  await assert.rejects(publishDownload({ file, secret: "test-secret", fetchImpl: async (url) => String(url).includes("api/publish") ? Response.json({ uploadUrl: "https://vercel.com/api/blob/?signed=test" }) : new Response(null, { status: 503 }) }), /upload failed/);
  await writeFile(file, "truncated DMG");
  await assert.rejects(publishDownload({ file, secret: "test-secret" }), /complete macOS DMG/);
});
