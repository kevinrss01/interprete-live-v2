import assert from "node:assert/strict";
import test from "node:test";
import { createUploadHandler } from "../api/publish-download.mjs";

async function request(handler, { method = "POST", authorization } = {}) {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method, headers: { authorization } }, response);
  return response;
}

test("rejects public callers and fails closed if publication is not configured", async () => {
  let issued = false;
  const handler = createUploadHandler({ getSecret: () => "test-secret", issueToken: async () => { issued = true; } });
  for (const authorization of [undefined, "Bearer wrong", "test-secret", ["Bearer test-secret"]]) {
    const response = await request(handler, { authorization });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["Cache-Control"], "no-store");
  }
  const missing = createUploadHandler({ getSecret: () => undefined });
  assert.equal((await request(missing, { authorization: "Bearer undefined" })).statusCode, 401);
  assert.equal(issued, false);
  const get = await request(handler, { method: "GET", authorization: "Bearer test-secret" });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, "POST");
});

test("authorized uploads are restricted to the DMG with a short expiration and cache", async () => {
  let issued;
  let signed;
  const now = Date.now();
  const handler = createUploadHandler({
    getSecret: () => "test-secret",
    issueToken: async (options) => { issued = options; return { delegationToken: "test" }; },
    signUrl: async (token, options) => { assert.equal(token.delegationToken, "test"); signed = options; return { presignedUrl: "https://vercel.com/api/blob/?signed=test" }; },
  });
  const response = await request(handler, { authorization: "Bearer test-secret" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(issued.operations, ["put"]);
  assert.equal(issued.pathname, "Interprete-macOS-arm64.dmg");
  assert(issued.validUntil >= now + 599_000 && issued.validUntil <= Date.now() + 600_000);
  assert.equal(signed.validUntil, issued.validUntil);
  assert.equal(signed.access, "public");
  assert.equal(signed.maximumSizeInBytes, 100 * 1024 * 1024);
  assert.deepEqual(signed.allowedContentTypes, ["application/x-apple-diskimage"]);
  assert.equal(signed.cacheControlMaxAge, 60);
  assert.equal(signed.allowOverwrite, true);
  assert.equal(signed.addRandomSuffix, false);
});

test("storage failures return a retryable error without provider credentials", async () => {
  const handler = createUploadHandler({ getSecret: () => "test-secret", issueToken: async () => { throw new Error("private provider details"); } });
  const response = await request(handler, { authorization: "Bearer test-secret" });
  assert.equal(response.statusCode, 503);
  assert(!JSON.stringify(response.body).includes("private provider details"));
});
