import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function verify({ existing, mismatch }: { existing: boolean; mismatch: boolean }) {
  const directory = await mkdtemp(join(tmpdir(), "deployment-verifier-"));
  const account = join(directory, "account.json");
  await writeFile(account, JSON.stringify({ email: "agent-local@example.com", password: "synthetic-test-password" }), { mode: 0o600 });
  let saved: { id: string; startedAt: number; messages: object[] } | undefined;
  const writes: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body).json : undefined;
    const send = (value: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    switch (request.url) {
      case "/api/status": return send({ session: "synthetic-session", services: { transcription: true, voice: true } });
      case "/api/interpret":
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        return response.end('data: {"type":"text","text":"Synthetic."}\n\ndata: {"type":"done","text":"Synthetic.","spoken":false}\n\n');
      case "/api/auth/sign-in/email": return send({ token: "synthetic-account-token" });
      case "/rpc/account/me": return send({ json: {} });
      case "/rpc/preferences/get":
      case "/rpc/voice/get": return send({ json: null });
      case "/rpc/voice/save": return send({ defined: false, code: "FORBIDDEN", status: 403, message: "Forbidden" }, 403);
      case "/rpc/discussions/list": return send({ json: existing ? [{ id: "existing-history" }]
        : saved ? [{ id: saved.id, startedAt: saved.startedAt, messageCount: 1 }] : [] });
      case "/rpc/discussions/save":
        writes.push("save"); saved = input;
        return send({ json: { id: saved!.id } });
      case "/rpc/discussions/messages": return send({ json: mismatch
        ? [{ ...saved!.messages[0], source: "PRIVATE_TRANSCRIPT_MARKER_FOR_TEST" }] : saved!.messages });
      case "/rpc/discussions/remove": writes.push("remove"); return send({ json: { id: input.id } });
      default: return send({}, 404);
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const script = fileURLToPath(new URL("../scripts/verify-deployment.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx/esm"), script,
      "--url", `http://127.0.0.1:${address.port}`, "--origin", "https://app.example.com", "--account-file", account],
    { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      });
      return { code, output, writes };
    } finally { clearTimeout(timer); }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

test("deployment verification refuses to mutate an account with existing history", async () => {
  const result = await verify({ existing: true, mismatch: false });
  assert.equal(result.code, 1);
  assert.match(result.output, /dedicated QA account with empty server history/);
  assert.deepEqual(result.writes, []);
});

test("deployment verification cleans its synthetic row without logging unexpected transcripts", async () => {
  const result = await verify({ existing: false, mismatch: true });
  assert.equal(result.code, 1);
  assert.match(result.output, /Saved synthetic history did not match/);
  assert.doesNotMatch(result.output, /PRIVATE_TRANSCRIPT_MARKER_FOR_TEST/);
  assert.deepEqual(result.writes, ["save", "remove"]);
});
