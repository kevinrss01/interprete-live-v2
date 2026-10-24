---
name: modern-javascript-patterns
description: Refactor Interprète TypeScript async flows and data handling for explicit ownership, cancellation, and readable contracts without changing speech behavior.
---

# TypeScript async and data patterns

Follow [AGENTS.md](../../../AGENTS.md). Read the target module's callers and tests
before changing its structure. Prefer existing patterns over syntax-only rewrites.

- Use async/await with explicit error propagation. Await independent work together
  when useful, but preserve ordering for capture, synthesis, playback, and cleanup.
  Account for still-running siblings when one promise rejects.
- Carry AbortSignal through owned work. Guard late results after a speaker/session
  changes, unregister listeners/timers, cancel stream readers, and close owned
  sockets/contexts in all terminal paths. Catch detached promises intentionally.
- Keep discriminated event types and shared contracts explicit. Validate unknown
  network data at boundaries rather than hiding uncertainty behind `any` or casts.
- Use nullish defaults when zero/empty values are valid. Treat object spread as
  shallow copying; do not accidentally share mutable audio queues across sessions.
- Keep ESM imports compatible with the package/build target. Prefer focused
  helpers and typed option objects over speculative abstractions or new libraries.

For behavioral refactors, cover cancellation, overlap, failures, and resource
cleanup with existing controller/streaming tests. Verify both consumers when
shared types or API inference change.
