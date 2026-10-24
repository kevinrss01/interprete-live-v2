---
name: update-dependencies
description: Update requested Interprète workspace dependencies and lockfiles, handle compatibility changes, and verify both API and desktop consumers without unrelated upgrades.
---

# Update dependencies

Follow [AGENTS.md](../../../AGENTS.md). Read root and workspace manifests,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and CI before choosing upgrade commands.

- Respect the requested packages and version scope. For a request for latest
  versions, resolve current stable releases and read official migration guidance
  for breaking changes; do not assume remembered versions are current.
- Manifests are in the root, `apps/desktop`, `apps/server`, and `packages/shared`.
  Preserve `workspace:*` links, ESM behavior, and the typed Hono server/client
  contract. Keep compatible React/types, Tailwind/Vite, and Tauri packages aligned.
- Do not upgrade Rust crates or the pnpm toolchain unless in scope or required
  for compatibility. Tauri native changes also involve `src-tauri/Cargo.toml`
  and its lockfile. Remove dependencies only after checking source, scripts,
  config, build tools, and workspace consumers for use.
- Run `pnpm install` after manifest edits, inspect the lockfile diff, and verify
  reproducibility with `pnpm install --frozen-lockfile`. Keep pnpm build-script
  approvals narrow; do not disable integrity checks to bypass installation errors.
- Run typecheck, lint, app tests, server bundle, and static UI build as documented.
  Include benchmark tests for affected tooling and native checks for native changes.

Report upgraded packages, compatibility fixes, actual checks, and any blockers.
Paid provider calls and publishing are separate from dependency verification.
