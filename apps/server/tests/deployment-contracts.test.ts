import assert from "node:assert/strict";
import test from "node:test";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { app } from "../src/app";

process.env.SESSION_SECRET = "test-only-deployment-contract-secret";
process.env.INTERPRETER_OPENAI_API_KEY = "test-only-openai";
delete process.env.ELEVENLABS_API_KEY;

test("the deployed HTTP route preserves captions-only requests without resolving a voice", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.equal(new URL(String(input)).hostname, "api.openai.com");
      return new Response('data: {"choices":[{"delta":{"content":"Hello."}}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const { session } = await (await app.request("/api/status")).json();
    const response = await app.request("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
      body: JSON.stringify({
        text: "Bonjour.", sourceLanguage: "fr", targetLanguage: "en", speaker: "b",
        // A captions-only request must not require a usable standard or cloned voice.
        voice: "unavailable-voice", isFinal: true, speak: false,
      }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).split("\n\n")
      .filter((block) => block.startsWith("data:"))
      .map((block) => JSON.parse(block.slice(5)) as InterpretationEvent);
    assert.deepEqual(events.map((event) => event.type), ["gate", "text", "done"]);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.spoken, false);
    assert.equal(done?.type === "done" && done.text, "Hello.");
  } finally {
    globalThis.fetch = original;
  }
});

test("status identifies a Git deployment and never exposes arbitrary environment values", async () => {
  const original = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    for (const [value, expected] of [
      ["a".repeat(40), "a".repeat(40)],
      ["not-a-commit", null],
      [undefined, null],
    ] as const) {
      if (value === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = value;
      const response = await app.request("/api/status");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal((await response.json()).revision, expected);
    }
  } finally {
    if (original === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = original;
  }
});
