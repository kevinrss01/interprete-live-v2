---
name: Interprète
description: A quiet, precise translation instrument for two people sharing one device.
colors:
  canvas: "#fafaf9"
  surface: "#ffffff"
  fill: "#f2f2f0"
  ink: "#1b1b1a"
  ink-2: "#4a4a47"
  ink-3: "#6b6b66"
  line: "#e8e7e3"
  line-2: "#d6d5d0"
  accent: "#cc3a2c"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  language:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  translation:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "-0.011em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  tag: "4px"
  field: "8px"
  control: "10px"
  talk: "14px"
  circle: "50%"
spacing:
  tight: "6px"
  small: "8px"
  medium: "12px"
  large: "16px"
  gutter: "24px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "44px"
  talk-idle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.talk}"
    padding: "0 14px 0 12px"
    height: "60px"
  talk-next:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.talk}"
    padding: "0 14px 0 12px"
    height: "60px"
  talk-live:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.talk}"
    padding: "0 14px 0 12px"
    height: "60px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "44px"
  tag:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.tag}"
    padding: "0 6px"
---

# Design System: Interprète

## Overview

**Creative North Star: "A quiet translation instrument"**

A precise, neutral workspace for two people sharing one device. Inter typography, restrained borders and generous conversation space keep the two speaking actions obvious. Names, voices, consent and service details belong in the secondary settings sheet.

This records the implemented, code-led redesign in `src/app/globals.css` and the interpreter, speaker and conversation components. The incumbent direction is preserved; no visual comp was requested.

**Key Characteristics:**
- Warm neutral canvas, white controls and charcoal hierarchy.
- Compact header, open conversation space and persistent two-person dock.
- One functional red accent for recording and errors.
- Flat surfaces, subtle corners and brief state transitions.

## Colors

### Primary

Charcoal (`ink`) identifies primary text and the next speaking action. Signal red (`accent`) identifies live recording and errors; it is not a decorative brand fill.

### Neutral

`canvas` unifies the page, header and dock. `surface` lifts controls and the sheet through tone alone. `fill` provides hover feedback and microphone wells. `ink-2` carries names and secondary text; `ink-3` carries supporting text. `line` separates regions and turns; `line-2` outlines controls.

**The Functional Accent Rule.** Reserve red for recording and errors; keep idle and working states neutral.

Opaque sRGB contrast, calculated from the source tokens: `ink-3` on `canvas` is **5.13:1**; white on `accent` is **4.99:1**; `accent` on `canvas` is **4.78:1**. These ratios do not describe opacity-reduced elements or constitute a whole-interface accessibility audit.

## Typography

Inter is loaded with `next/font` and exposed as `--font-body`; the CSS fallback is a sans-serif system stack. No separate display face is used.

- **Title:** compact wordmark and sheet heading, using the title token.
- **Language:** semibold selectors, reducing to (16px) at the compact breakpoint.
- **Translation:** the strongest reading text, capped at (62ch), reducing to (17px) on compact screens.
- **Body:** standard text; source transcripts use a slightly looser line height (1.55).
- **Supporting text:** (12–13px); language codes and compact tags use (11px). Names use medium or semibold weight. Tabular numerals stabilize timings and progress.

**The Translation First Rule.** Give translated speech greater size and contrast than its source transcript or metadata.

## Layout

The content frame is (760px) plus (24px) gutters on either side. A full-height flex shell leaves conversation space between the sticky header and bottom dock. The header is (56px); the dock has two equal speaker columns around a (44px) swap/stop control, with (16px) gaps. Each speaker stacks metadata, language selection and a speaking button.

Conversation turns form a single column, with a (20px) speaker mark and (14px) gap. Turns use hairline separators, not cards. New content follows the reader only when they are already near the bottom.

At widths of (640px) or less, gutters become (16px), header height (52px), dock gaps (8px), and speaking controls (56px) tall. The two speakers stay side by side. The desktop sheet is a right-hand panel up to (420px) wide; on compact screens it becomes a bottom sheet capped at (90dvh). Safe-area insets protect its content and the dock. Voice status is hidden at (360px) or less; keyboard hints are hidden on devices without hover.

## Elevation & Depth

The interface uses tonal separation and hairlines, with no drop shadows for depth. The modal backdrop dims the canvas at (24%) charcoal. The live speaking control has a red ring that grows with input level; it is audio feedback, not a surface shadow. The disconnected status dot uses an inset outline.

State transitions use `--ease`: controls change over (150ms), press feedback over (120ms), and the sheet enters over (200ms). Audio feedback responds over (80ms); cloning progress uses (300ms). Spinners and the listening status pulse signal ongoing work. Reduced-motion preference removes transitions and CSS animations.

## Shapes

Fields have restrained (8px) corners, general controls (10px), and speaking controls and the mobile sheet (14px). Speaker marks, microphone wells and the central dock control are circular. Borders are thin and neutral; maintain the flat rectangular conversation surface.

## Components

### Buttons

Neutral buttons have white fill, a control border and a minimum height of (44px). Quiet buttons remove the resting fill and border, then use `fill` on hover. Icon buttons occupy (44px) squares. Focus uses a (2px) charcoal outline with (2px) offset; do not rely on hover alone.

### Speaking controls

Idle is white; next, connecting, working and playback are charcoal. Live recording is red, shows the input meter and offers “Terminer”. During continuous translation, live recording remains active while output plays; the header says “Écoute et traduction…”. Connecting shows a spinner and can be cancelled. Working/playback after capture keep full opacity; the other speaker is disabled at (40%) opacity. Press feedback scales to (0.985). The A mark is outlined; B is charcoal-filled, consistently in the dock and transcript.

### Fields and settings

Native text fields and selects use (44px) height and neutral borders. Settings fields become (16px) text on compact screens. Consent uses a native checkbox within a (44px) minimum label row. Settings groups are divided by hairlines; the native dialog handles the secondary sheet.

### Header, transcript and tags

The compact header contains the wordmark, live status and settings control. Transcript turns pair a small identity mark with metadata, quieter source text and stronger translation. The small outlined “Exemple” tag identifies demo content without creating a competing accent.

## Do's and Don'ts

### Do:
- **Do** keep the two speaking actions prominent and settings secondary.
- **Do** preserve the charcoal/white state hierarchy and functional red accent.
- **Do** use Inter, quiet dividers, visible keyboard focus and brief motion.
- **Do** retain concise French copy and compact-screen field text of (16px).

### Don't:
- **Don't** add gradients, glass, decorative shadows, illustrations, emojis or slogans to this neutral instrument.
- **Don't** wrap transcript turns in cards or add a competing visual identity for each speaker.
- **Don't** use red as a routine action or decorative fill.
- **Don't** treat opacity-reduced keyboard hints or development-only overlays as normative text or components.
