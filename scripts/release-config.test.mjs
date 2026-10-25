import assert from "node:assert/strict";
import test from "node:test";
import { releaseConfig } from "./release-config.mjs";

test("stable version produces its release tag", () => {
  assert.deepEqual(releaseConfig({ version: "0.1.0", apiUrl: "https://api.example.com" }), { tag: "v0.1.0" });
});

test("rejects prerelease, malformed and unsafe versions", () => {
  for (const version of ["0.1.0-beta.1", "v0.1.0", "01.0.0", "1.0", "1.0.0\n", "1.0.0\ntag=other"]) {
    assert.throws(() => releaseConfig({ version, apiUrl: "https://api.example.com" }));
  }
});

test("rejects missing, local, insecure or credential-bearing API URLs", () => {
  for (const apiUrl of [undefined, "", "http://api.example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://user:password@api.example.com", "https://api.example.com?token=value", "https://api.example.com#fragment"]) {
    assert.throws(() => releaseConfig({ version: "0.1.0", apiUrl }));
  }
});
