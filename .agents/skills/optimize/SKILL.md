---
name: optimize
description: Diagnose and improve measured Interprète startup, render, memory, or speech-pipeline latency while preserving translation correctness, cancellation, and consent boundaries.
---

# Optimize a measured bottleneck

Follow [AGENTS.md](../../../AGENTS.md). Establish the slow behavior and a bounded
baseline before editing. Read relevant callers and existing measurements/tests.

- Separate capture startup, connection readiness, first transcript, segment
  decision, translation, first audio byte, and scheduled playback. Do not present
  provider latency or scheduled playback as measured acoustic end-to-end latency.
- For UI problems, inspect render frequency, long transcripts, audio-level updates,
  scroll work, and expensive effects. Optimize the demonstrated hot path rather
  than applying memoization throughout the app.
- For transport/memory problems, inspect queue growth, backpressure, timers,
  readers, sockets, and reconnect buffers. Keep bounds and ownership explicit.
- Preserve translation meaning, prefix/final-remainder handling, audio ordering,
  cancellation, session separation, and consent. Faster speculative output that
  speaks the wrong negation or number is a regression.
- Compare the same synthetic input/configuration before and after. Keep tests
  silent and use real providers only when authorized. Report sample size and
  variance; a single phrase is not a representative latency benchmark.

Run relevant regressions and report the measured improvement, tradeoffs, and
remaining uncertainty. Do not change models or provider spend without task scope.
