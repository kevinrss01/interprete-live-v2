---
name: make-interfaces-feel-better
description: Polish Interprète typography, spacing, surfaces, and interaction feedback within its existing quiet visual direction, without changing the conversation workflow.
---

# Polish interface details

Follow [AGENTS.md](../../../AGENTS.md) and [DESIGN.md](../../../DESIGN.md), then
inspect current `apps/desktop/src/globals.css` and the target components.

- Identify the visible problem before editing: awkward wrapping, weak hierarchy,
  inconsistent alignment, cramped targets, abrupt state changes, or noisy surfaces.
  Preserve the user's requested scope and the existing two-speaker composition.
- Keep translated text dominant, supporting text readable, and measured timings
  stable with tabular numerals. Check long language names and multi-line content.
- Align icons optically with labels, keep nested radii consistent with spacing,
  and extend hit areas without moving the visible control. Preserve the flat
  neutral palette and functional recording/error accent.
- Apply hover feedback only where hover exists. Keep press/focus/loading states
  clear, use specific transitions, and preserve reduced-motion behavior. Do not
  add decorative motion or new libraries to solve a spacing problem.
- Keep auto-scroll conditional on the reader being near the bottom. UI polish
  must not interrupt transcript reading or reset capture/controller state.

Verify before/after at relevant sizes and in empty, active, settings, and error
states. Report observable improvements and any interaction states not verified.
