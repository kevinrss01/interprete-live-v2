---
name: adapt
description: Adapt Interprète layouts to compact, desktop, touch, or native-window contexts while preserving speaker controls, transcript reading, settings, and keyboard access.
---

# Adapt a layout

Follow [AGENTS.md](../../../AGENTS.md) and [DESIGN.md](../../../DESIGN.md).
Inspect the requested context, current breakpoints, and component constraints.
Infer routine sizes from the implemented design; ask only if the target is unclear.

- Preserve the two-person workflow and keep both speaking actions discoverable.
  Adapt information density and settings placement before hiding core actions.
- Check long language labels, large text, growing conversations, empty/error
  states, and the settings sheet with the onscreen keyboard where applicable.
- Respect touch hit targets, safe areas, reduced motion, and devices without
  hover. Avoid fixed heights that clip controls or force nested scrolling.
- Preserve reading position when content grows. Settings and docks must not
  cover the latest visible turn or trap focus outside their active surface.
- Check the Tauri minimum window configuration before promising narrower native
  support; a compact browser viewport does not prove a mobile native build.

Verify the target size plus an adjacent breakpoint and a wider regression case.
Report what adapted, the states/sizes checked, and native limitations separately.
