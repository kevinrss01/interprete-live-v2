---
name: animate
description: Add or fix purposeful Interprète state transitions and interaction feedback while preserving immediate speech controls, reduced motion, and audio timing.
---

# Animate interaction feedback

Follow [AGENTS.md](../../../AGENTS.md) and [DESIGN.md](../../../DESIGN.md).
Read current CSS transitions and motion preferences before adding effects.

- Choose motion that clarifies a state or spatial relationship: recording,
  working, opening settings, or switching a control. Match the quiet interface;
  do not invent a hero animation or decorative entrance sequence.
- Keep functional updates immediate. Starting, cancelling, or finishing a turn
  must not wait for an animation. Animation completion cannot own audio cleanup.
- Prefer existing CSS transitions for simple feedback, targeting specific
  properties. Use transform/opacity where suitable and avoid layout/paint-heavy
  effects on the streaming hot path. Do not add a library for a simple transition.
- Keep feedback brief and interruptible; reuse existing timing/easing tokens.
  Rapid toggles, component removal, and cancellation must leave a coherent state.
- Provide reduced-motion behavior that preserves status information without
  movement. Show essential information through text/icon state as well as motion.

Verify keyboard/touch interaction, interrupted transitions, reduced motion, and
streaming updates silently. Report timing choices and any measured performance
limits; do not claim a frame-rate guarantee from visual inspection alone.
