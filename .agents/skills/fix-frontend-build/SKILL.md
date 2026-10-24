---
name: fix-frontend-build
description: Diagnose and fix Interprète desktop TypeScript and Vite build failures. Distinguish the static UI build from Tauri native packaging failures.
---

# Fix the desktop build

Follow [AGENTS.md](../../../AGENTS.md). Read the failing command/log and desktop
manifest before reproducing. Use `pnpm --filter @interprete/desktop build` from
the root for TypeScript plus Vite; `pnpm build:desktop` also builds the native app.

- Trace the first actionable error through imports, config, and shared contracts.
  The desktop imports Hono's server route types: an API type error may originate
  in `apps/server`, even when reported by the desktop compiler.
- Fix the cause with the smallest compatible change. Preserve static frontend
  output, environment-based API URLs, and server-only credential boundaries.
- Do not suppress errors with broad casts, ignored diagnostics, removed checks,
  or unrelated dependency upgrades. Do not add Node-only runtime code to the UI.
- Rerun the failed build after a meaningful fix, plus affected tests. Stop blind
  retries if the same error is unchanged; inspect missing tools/dependencies.
- For Rust, entitlements, capabilities, signing, or platform errors, use
  [rust-engineer](../rust-engineer/SKILL.md) and the native command instead.

Report the cause, patch, and which build actually passed. A Vite build alone does
not establish native packaging or microphone access.
