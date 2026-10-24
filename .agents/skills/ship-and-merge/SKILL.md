---
name: ship-and-merge
description: >-
  Publish and merge the Interprète task PR after checks, reviews, and conflicts
  are clean. Explicit /ship-and-merge or $ship-and-merge only; editing or
  discussing this skill does not invoke it.
disable-model-invocation: true
---

# Ship and merge

Explicit `/ship-and-merge` or `$ship-and-merge` authorizes committing, pushing,
opening/updating, fixing, and merging this task PR. Do not ask again. User limits
such as stay local, no push, or no merge take precedence. Manual deployment,
direct pushes to the base, force-pushes, and admin bypass are outside this skill.

Read `AGENTS.md`. Use `.agents/skills/ship-and-merge/` as the canonical copy;
the `.codex/skills/` and `.claude/skills/` entries link here.

1. **Prepare once.** Inspect status, remote, branch, and task diff. Fetch the
   intended base (`origin/main` unless explicitly overridden). Reuse a focused
   task branch when its complete diff contains only this task; otherwise isolate
   the work on a clean branch from that base. Preserve unrelated edits and commits.
2. **Verify the changed surface.** Follow `AGENTS.md` and the actual CI workflow.
   Docs-only changes need path/link checks, skill validation when applicable, and
   `git diff --check`. App changes need CI-equivalent checks and relevant regression
   coverage; native changes also need native verification. Reuse results for
   unchanged code; repeat checks when edits, failures, or base updates warrant it.
3. **Publish.** Verify author/committer use the configured GitHub no-reply email,
   stage only task hunks, commit, and push the task branch. Open/update the PR in
   the repository identified by `origin`, targeting the intended base. Verify its
   URL, base, branch, full head SHA, commits, and complete diff. Link it to the
   current thread when the host provides PR linking. Keep the description concise:
   problem/result, verification, and material limitations.
4. **Clear gates on that SHA.** Determine expected checks and required reviews
   from workflow triggers, repository configuration, and branch rules. Wait for
   expected checks to register; inspect their latest attempts, review findings,
   and unresolved threads. Fix confirmed defects, explain false positives in the
   PR, and resolve addressed threads. Rerun transient failures or required stale
   reviews through supported actions. Merge base conflicts into the task branch
   without rewriting history, then push and recheck. Do not weaken checks.
5. **Merge and prove it.** Immediately reread the head SHA and gates below. If
   the head changed, reevaluate. Merge only the verified SHA, using a merge commit:

   ```sh
   gh pr merge PR_NUMBER --repo OWNER/REPO --merge --match-head-commit HEAD_SHA
   ```

   Substitute the verified values; never add `--admin` or delete the branch.
   Confirm GitHub reports the PR merged, fetch the base, and confirm the merge
   commit is reachable from it. Report the PR URL, merge commit, and actual checks.
   Report deployment separately, only if requested and verified.

## Merge gates

- Correct PR/base; complete diff contains only task changes; `MERGEABLE` and `CLEAN`.
- Expected checks have registered on the latest SHA. Every latest check attempt
  has completed successfully or neutrally; skipped checks are acceptable only
  when not required. Pending, missing, failed, cancelled, or unknown results block.
- Required human/AI reviews satisfy repository rules for the latest SHA, with no
  outstanding change requests or unresolved real defects. A skipped required AI
  review is not a review. Do not invent dependencies on unconfigured review bots.

Use host-native PR watching when available; otherwise wait with a bounded CLI
watch. If a required check/review has not registered after about 10 minutes, report
the PR, SHA, and missing gate. Stop on unavailable access, unsafe conflicts, or a
refused merge; report the blocker without bypassing it or claiming completion.
