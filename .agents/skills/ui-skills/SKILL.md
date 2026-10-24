---
name: ui-skills
description: Implement or audit Interprète controls and layouts against the existing design, keyboard, focus, accessibility, and error-feedback requirements.
---

# UI implementation constraints

Follow [AGENTS.md](../../../AGENTS.md), [PRODUCT.md](../../../PRODUCT.md), and
[DESIGN.md](../../../DESIGN.md). Confirm current styling in
`apps/desktop/src/globals.css`; some design prose still names older framework paths.

- Reuse the React/Tailwind/Lucide stack, current tokens, and existing controls.
  Do not introduce HeroUI, a new primitive system, or an animation library merely
  because another project's skill recommends one.
- Keep the two speaker actions obvious, translations prominent, and voice/consent
  details in secondary settings. French copy should explain the user's next action.
- Use semantic buttons and inputs, associated labels, accessible names for icon
  controls, visible keyboard focus, and usable hit targets. Preserve A/B/Escape
  handling without hijacking typing in editable controls.
- Preserve dialog focus containment, focus restoration, escape/close behavior,
  and consent for destructive voice actions. Disable conflicting actions only
  while necessary and show relevant loading/errors near the triggering control.
- Preserve safe-area spacing, contrast, reduced motion, and overflow handling.
  Use existing theme values before adding new colors, shadows, or type styles.

For audits, report concrete violations with locations and remedies. For requested
implementation, verify relevant states at desktop/compact sizes silently.
