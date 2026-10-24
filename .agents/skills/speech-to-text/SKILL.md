---
name: speech-to-text
description: Implement or debug Interprète's continuous OpenAI transcription, PCM capture, item finalization, and reconnect behavior without ending the speaker's turn.
---

# Continuous speech transcription

Follow [AGENTS.md](../../../AGENTS.md). Read
`apps/desktop/src/lib/transcription.ts`, `audio.ts`, `interpreter.ts`, and
`apps/server/src/lib/openai.ts`. This app uses its existing OpenAI transport;
do not install a different speech SDK to follow generic transcription examples.

- Keep permanent credentials server-side and obtain an ephemeral session through
  the typed API. Inspect current model/config and official provider docs for a
  provider change; do not hardcode a remembered model or token lifetime.
- Preserve PCM format and frame boundaries from capture through buffering and
  sending. Start capture/connection concurrently without losing initial frames.
- Distinguish partial text, finalized items, and the human turn lifetime. Associate
  provider item IDs with the correct chunks; pauses and item commits do not stop
  the microphone. Only explicit finish/cancel or a terminal failure ends capture.
- Keep connection renewal and replay bounded. Do not duplicate finalized audio,
  mix speakers, or apply late events after cancellation. Surface unrecoverable loss.
- Verify with synthetic frames and mocked sockets: delayed connection, partial
  corrections, reordered item completion, renewal, reconnect, and abort races.
  Existing desktop streaming/controller tests are the starting point.

Use authorized live tests only after checking current auth/transport, always
silently. Report actual transcript/latency observations and untested acoustics.
