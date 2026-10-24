---
name: text-to-speech
description: Implement or debug Interprète's ElevenLabs streaming synthesis and ordered PCM playback, preserving voice ownership, cancellation, and final-remainder behavior.
---

# Streaming translated speech

Follow [AGENTS.md](../../../AGENTS.md). Read
`apps/server/src/lib/eleven.ts`, `interpret.ts`, `voices.ts`, and
`apps/desktop/src/lib/audio.ts`/`interpreter.ts` before changing synthesis.

- Reuse the existing WebSocket transport and server-side credentials. Model IDs
  live in `apps/server/src/lib/config.ts`; verify official docs before changing
  provider parameters, output formats, or voice settings.
- Resolve voice authorization by speaker/session. Keep consent and clone lifecycle
  separate from text generation. A voice change applies to the next synthesis
  request; never silently reuse another profile's clone.
- Preserve the configured PCM format across socket, SSE, decoding, and scheduling.
  Start playback as chunks arrive, in order, while capture continues. Finalization
  translates/speaks only the remainder rather than replaying the whole turn.
- Handle socket errors, premature closure, incomplete SSE, and cancellation as
  distinct terminal states. Close readers/sockets and discard late chunks after
  abort; avoid retrying already-spoken text or duplicating paid synthesis.
- Verify synthetic chunk boundaries, ordered scheduling, finish/abort races,
  voice isolation, and empty/error responses with mocked playback and providers.

Real provider tests must be authorized and silent: inspect bytes/timing without
speaker output. Report first-byte and scheduled-playback metrics separately from
acoustic latency or perceived voice quality, which require different evidence.
