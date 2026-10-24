---
name: create-pull-request
description: Prepare, verify, commit, push, and open or update an Interprète task pull request. Stops at PR delivery unless merging is separately authorized.
---

# Create a pull request

Follow [AGENTS.md](../../../AGENTS.md). An explicit request to open a PR covers
committing and pushing its task changes; it does not cover merging or deployment.

1. Inspect status, `origin`, branch, and history. Fetch the requested base
   (`origin/main` by default). Reuse a focused task branch or create one from the
   base, preserving dirty user work. Check the complete diff against the base.
2. Review changes and run applicable checks. Fix confirmed task defects without
   adding unrelated work. Do not run nonexistent root `pnpm build` or rebuild
   every app for documentation-only changes.
3. Verify Git author/committer use the configured GitHub no-reply identity.
   Stage task hunks, commit, and push the task branch without rewriting history.
4. Use the repository from `origin`. Check for an existing PR for this branch
   before creating another; verify its base, branch, and full head SHA.
5. Write the title and body around the final change: problem/result, meaningful
   validation, and material limitations. Use structured arguments or a body file
   to preserve newlines. Include an existing issue only when this task has one.
6. Register the PR with the host's linking tool when available. Report its URL,
   head SHA, and checks/review state; do not call pending checks successful.

For an explicitly authorized merge, continue with
[ship-and-merge](../ship-and-merge/SKILL.md).
