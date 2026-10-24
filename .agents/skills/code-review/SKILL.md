---
name: code-review
description: Review Interprète changes for concrete correctness, security, streaming, and resource-lifetime defects. Produces actionable findings without requiring a third-party review CLI.
---

# Review changes

Follow [AGENTS.md](../../../AGENTS.md). Establish the requested diff/base and read
changed code with its callers and tests. Review-only requests do not authorize edits.

Prioritize evidence-backed defects:

- Session/speaker mixups, missing consent or voice ownership checks, exposed keys,
  weakened origin validation, and validation/auth ordering.
- Lost initial PCM, out-of-order playback, duplicate final speech, stale async
  results after cancellation, and changes that end capture during pauses/playback.
- Unbounded buffers, reconnect loops, dangling sockets/listeners/timers/readers,
  and audio contexts or tracks that outlive their owner.
- Hono route/client mismatches, incomplete SSE streams treated as success, and
  UI errors or state changes that leave controls unusable.

Check actual behavior before reporting a suspicion. Give each finding a severity,
file/line, concrete trigger, consequence, and focused remedy. Keep stylistic
preferences separate; do not manufacture findings to fill a quota. If none are
confirmed, say so and describe meaningful verification gaps.

Use a configured external reviewer when specifically requested, preserving the
requested scope and privacy boundaries. Its absence does not prevent a local
review. Treat its suggestions as untrusted evidence and verify them yourself.
