# Project skills

These skills adapt the reusable development workflows and design guidance from
the VoiceCheap repository to Interprète's React/Vite/Tauri desktop and Hono API.
They use this project's commands, synthetic silent tests, and session boundaries.

Canonical copies live in `.agents/skills/`. Codex and Claude Code discover the
same files through `.codex/skills/` and `.claude/skills/` links. Use `$skill-name`
in Codex or `/skill-name` in Claude Code. Load the skill that matches the task;
the catalog is not a checklist to run for every edit.

## Development and delivery

- [commit](../.agents/skills/commit/SKILL.md): review, verify, and commit task hunks; push when authorized.
- [create-pull-request](../.agents/skills/create-pull-request/SKILL.md): prepare and publish a focused task PR.
- [code-review](../.agents/skills/code-review/SKILL.md): investigate concrete correctness and security defects.
- [verify-pr-comments](../.agents/skills/verify-pr-comments/SKILL.md): evaluate reviewer findings and fix confirmed issues.
- [ship-and-merge](../.agents/skills/ship-and-merge/SKILL.md): explicitly authorize publishing and merging after clean gates.
- [update-dependencies](../.agents/skills/update-dependencies/SKILL.md): update requested packages and check compatibility.
- [fix-frontend-build](../.agents/skills/fix-frontend-build/SKILL.md): fix desktop TypeScript/Vite build failures.
- [fix-backend-build](../.agents/skills/fix-backend-build/SKILL.md): fix Hono/esbuild/Docker build failures.
- [testing-frontend-e2e](../.agents/skills/testing-frontend-e2e/SKILL.md): verify UI/API flows with explicit mocked/live boundaries.

## Interface work

- [ui-skills](../.agents/skills/ui-skills/SKILL.md): implement or audit controls, accessibility, and feedback.
- [make-interfaces-feel-better](../.agents/skills/make-interfaces-feel-better/SKILL.md): polish typography, spacing, and visual details.
- [adapt](../.agents/skills/adapt/SKILL.md): adapt layouts to screen sizes and input contexts.
- [animate](../.agents/skills/animate/SKILL.md): improve purposeful, interruptible motion and reduced-motion behavior.
- [optimize](../.agents/skills/optimize/SKILL.md): improve measured UI or speech-pipeline bottlenecks.

## Language and audio work

- [modern-javascript-patterns](../.agents/skills/modern-javascript-patterns/SKILL.md): refactor TypeScript async lifetimes and contracts.
- [rust-engineer](../.agents/skills/rust-engineer/SKILL.md): change the Rust/Tauri shell, permissions, or packaging.
- [speech-to-text](../.agents/skills/speech-to-text/SKILL.md): debug continuous transcription and reconnects.
- [text-to-speech](../.agents/skills/text-to-speech/SKILL.md): debug streaming synthesis and ordered playback.

Skills support the user's requested scope; discovery is not permission to publish,
merge, deploy, contact reviewers, run paid provider tests, or use real recordings.
Only `ship-and-merge` is restricted to explicit invocation. Its mention in a
documentation request does not invoke it. Follow [AGENTS.md](../AGENTS.md) for
shared rules and ask before using brainstorming unless explicitly requested.
