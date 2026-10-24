---
name: testing-frontend-e2e
description: Verify Interprète UI flows and API integration with synthetic input and silent playback, distinguishing mocked browser coverage from live provider and native desktop checks.
---

# Verify the app flow

Follow [AGENTS.md](../../../AGENTS.md). Inspect existing processes, environment
examples, and tests before starting anything. Use the local API and configured
`VITE_API_URL`; do not default to a production service or copy another app's login.

- Browser UI: `pnpm --filter @interprete/desktop dev:web` on port 1420; API:
  `pnpm dev:server` on port 3035. Use authorized local configuration without
  overwriting existing environment files. Missing credentials are a blocker for
  live calls, not a reason to point tests at an unrelated backend.
- Prefer the host's browser tools. Keep automated capture and playback synthetic
  and silent. Mock provider/stream boundaries when real calls are outside scope;
  verify those mocks still match the current contracts.
- Cover language/profile selection, start/finish/cancel, A/B/Escape controls,
  settings focus/close, errors, reconnect states, long transcripts, and scrolling.
  Inspect desktop and compact layouts relevant to the change.
- For streaming changes, check first output during capture, ordered chunks,
  final remainder without repetition, and no late output after cancellation.
  Use existing controller/stream tests and add focused regressions where needed.
- For authorized live-provider tests, inspect `scripts/verify-live-app.ts` against
  current bearer auth, origins, and transport first; its historical cookie logic
  must not be assumed compatible. Never use real recordings or audible playback.

Report which boundaries were mocked, which endpoints actually ran, and outcomes.
Browser QA does not prove native permissions, acoustics, or long-session recovery.
