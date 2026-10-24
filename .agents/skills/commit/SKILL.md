---
name: commit
description: Review and commit the current Interprète task changes, with checks appropriate to the diff. Push only when the request or an invoked shipping workflow authorizes it.
---

# Commit task changes

Follow [AGENTS.md](../../../AGENTS.md). Inspect status, branch, staged changes,
and unstaged changes before deciding what belongs to the task.

1. Review the task diff and its callers for actual defects, especially session
   boundaries, cancellation, audio ordering, and resource cleanup. Fix defects
   within the authorized implementation scope; avoid unrelated cleanup.
2. Run the checks for the changed surface from `AGENTS.md`. Documentation needs
   path/link checks and `git diff --check`, not an app build. Reuse still-valid
   results rather than repeating the same suite without a code change.
3. Stage only task files or hunks. Inspect the staged diff for unrelated changes,
   secrets, generated artifacts, and accidental environment files.
4. Check `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT` against the
   configured GitHub no-reply email. Preserve the identity and existing history.
5. Create a descriptive commit. If push is authorized, recheck identity and push
   the task branch without force; otherwise report the local commit.

Do not silently stash, discard, amend unrelated commits, or push to the base.
Report the SHA, checks, and whether a push actually completed.
