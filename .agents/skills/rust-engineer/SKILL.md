---
name: rust-engineer
description: Work on Interprète's Rust Tauri shell, plugins, permissions, and native packaging using the repository's edition and platform configuration.
---

# Rust and Tauri changes

Follow [AGENTS.md](../../../AGENTS.md). Read
`apps/desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, capabilities, and the native
entrypoint. Use the configured edition (currently 2024), not an older tutorial.

- Keep the shell small; speech providers and permanent secrets belong to the
  Hono server. Do not introduce native key storage or duplicate transport logic
  unless the task requires it.
- Prefer ownership/borrowing and Result/Option over shared mutable globals or
  panics in recoverable paths. Preserve intentional startup failure handling.
  Document safety invariants for any necessary unsafe code.
- Keep blocking work off interactive/async paths. Add runtime dependencies only
  when needed; do not introduce Tokio merely because this is Rust code.
- Grant Tauri commands/plugins only the capabilities the task needs. Preserve
  window scoping, microphone declarations, and macOS hardened-runtime entitlements.
- From `apps/desktop/src-tauri`, run `cargo fmt --check`, `cargo check --locked`,
  and relevant `cargo test --locked`/`cargo clippy --locked` for Rust changes.
  Use `pnpm build:desktop` from the root for affected native packaging.

Inspect lockfile changes and distinguish compiler errors from missing platform
tools, signing, or notarization prerequisites. Report the actual target checked;
one platform's build does not establish another platform's release readiness.
