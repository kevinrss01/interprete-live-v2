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
    padding: "0 12px 0 8px"
    height: "48px"
  talk-next:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.talk}"
    padding: "0 12px 0 8px"
    height: "48px"
  talk-live:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.talk}"
    padding: "0 12px 0 8px"
    height: "48px"
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
- Compact header, open conversation space, and a two-person dock floating over the transcript.
- One functional red accent for recording and errors.
- Flat surfaces, subtle corners and brief state transitions.

## Colors

### Primary

Charcoal (`ink`) identifies primary text and the next speaking action. Signal red (`accent`) identifies live recording and errors; it is not a decorative brand fill.

### Neutral

`canvas` unifies the page and header. The dock is a translucent white surface over the conversation. `surface` lifts controls and the sheet through tone alone. `fill` provides hover feedback and microphone wells. `ink-2` carries names and secondary text; `ink-3` carries supporting text. `line` separates regions and turns; `line-2` outlines controls.

**The Functional Accent Rule.** Reserve red for recording and errors; keep idle and working states neutral.

Opaque sRGB contrast, calculated from the source tokens: `ink-3` on `canvas` is **5.13:1**; white on `accent` is **4.99:1**; `accent` on `canvas` is **4.78:1**. These ratios do not describe opacity-reduced elements or constitute a whole-interface accessibility audit.

### Color mode

The desktop app stores `light` or `dark` on the device (`interprete-theme`). Light is the default and uses the tokens above. Dark keeps the same roles on a warm near-black canvas (`#141413`) with a lifted panel (`#1e1e1c`): text inverts to warm off-white, and the recording red lightens to `#f26456` so it stays readable both as text and as dark type on the live control. The wordmark image is inverted so the orange mark stays orange. Captions, the call toast, and the translation pill keep their own colors.

## Typography

Inter is loaded with `next/font` and exposed as `--font-body`; the CSS fallback is a sans-serif system stack. No separate display face is used.

- **Title:** compact wordmark and sheet heading, using the title token.
- **Language:** semibold selectors at (16px), on the line under the name and aligned with the speaker mark.
- **Translation:** the strongest reading text inside a bubble, (16px), capped at (62ch), reducing to (15px) on compact screens.
- **Body:** standard text; source lines inside a bubble are (13px) with a slightly looser line height (1.5).
- **Supporting text:** (12–13px); language codes and compact tags use (11px). Names use medium or semibold weight. Tabular numerals stabilize timings and progress.

**The Translation First Rule.** Give translated speech greater size and contrast than its source transcript or metadata.

## Layout

The content frame is (760px) plus (24px) gutters on either side. A full-height flex shell leaves the conversation open to the top of the panel. History, voices, settings, and call pages have no toolbar and share a (28px) top inset. On the discussion, Audio sample is a frosted chip with a play icon, set down from the top of the panel and pulled to its start edge, with the dock’s hairline and (16px) radius. New discussion is the first sidebar action, above Conversation, with a compose icon. The five most recently updated discussions are listed under the navigation. History keeps the full retained list. When the sidebar is hidden, New discussion returns as a chip above Audio sample. The dock floats over the bottom of the transcript. A speech error or warning sits in its own surface just above that dock, outside the speaker card, and its dismiss control has no hover fill. Two equal speaker columns meet at a (36px) swap/stop control, with (10px) gaps. Each column starts at the same edge: mark and name on one line, with the voice at the end of that line, and the language on the next line, aligned with the speaker mark. Then a (48px) speaking button. A caption under the controls shows live status and whether the microphone is on. Longer microphone guidance appears on its own line only while connecting, listening, or playing a sample; the same sentence stays available to assistive tech the rest of the time. The conversation keeps clearance for both floating surfaces so the latest turn can scroll clear of them.

Conversation turns are bubbles in one column. Speaker A sits at the start and speaker B at the end, with a (14px) gap. The name inside the bubble identifies the speaker. A bubble uses the panel’s (16px) radius, with a (6px) corner toward its side. A new bubble fades and rises over (240ms). While that person is still speaking, the bubble border pulses in the recording color; reduced motion keeps that border still. New content follows the reader only when they are already near the bottom.

At widths of (640px) or less, gutters become (16px), header height (52px), dock gaps (8px), and speaking controls (52px) tall. The two speakers stay side by side. The desktop sheet is a right-hand panel up to (420px) wide; on compact screens it becomes a bottom sheet capped at (90dvh). Safe-area insets protect its content and the dock. Voice status is hidden at (360px) or less; keyboard hints are hidden on devices without hover.

## Elevation & Depth

The interface uses tonal separation and hairlines, with no drop shadows for depth. The modal backdrop dims the canvas at (24%) charcoal. The live speaking control has a red ring that grows with input level; it is audio feedback, not a surface shadow. The ready status dot is a plain (8px) green circle (`#2fbe4f`). Listening and a live call use the same circle in signal red. The disconnected status dot uses an inset outline.

State transitions use `--ease`: controls change over (150ms), press feedback over (120ms), and the sheet enters over (200ms). Audio feedback responds over (80ms); cloning progress uses (300ms). Leaving onboarding runs for (460ms). The onboarding fades and eases back over (180ms); the app fades in over (420ms) while a fixed soft focus clears. The blur radius does not animate. Spinners and the listening status pulse signal ongoing work. Reduced-motion preference removes transitions and CSS animations, including that handoff.

## Shapes

Fields have restrained (8px) corners, general controls (10px), and speaking controls and the mobile sheet (14px). The app panel, the floating dock, and discussion bubbles use (16px). Speaker marks, microphone wells and the central dock control are circular. Borders are thin and neutral.

## Components

### Buttons

Neutral buttons have white fill, a control border and a minimum height of (44px). Quiet buttons remove the resting fill and border, then use `fill` on hover. Icon buttons occupy (44px) squares. Focus uses a (2px) charcoal outline with (2px) offset; do not rely on hover alone.

### Speaking controls

Idle is white; next, connecting, working and playback are charcoal. Live recording is red, shows the input meter and offers “Terminer”. During continuous translation, live recording remains active while output plays; the header says “Écoute et traduction…”. Connecting shows a spinner and can be cancelled. Working/playback after capture keep full opacity; the other speaker is disabled at (40%) opacity. Press feedback scales to (0.985). The A mark is outlined; B is charcoal-filled, in the dock only.

### Fields and settings

Native text fields and selects use (44px) height and neutral borders. Settings fields become (16px) text on compact screens. Consent uses a native checkbox within a (44px) minimum label row. Settings groups are divided by hairlines; the native dialog handles the secondary sheet.

### Home

Every launch opens on a single question, “Que voulez-vous traduire ?”, and two full-width rows divided by hairlines: Conversation (with the current language pair) and Réunion en ligne. Rows use a (20px) semibold title, a short supporting line and a trailing arrow; hover fills the row and nudges the arrow. The column is (560px) wide and vertically centred. The `a`/`b` speaking shortcuts only work inside the conversation.

### Meeting setup

The meeting view is a settings-style form: labelled sections (Langues, Son, Détection) in a (120px) label column, divided by hairlines, then the start control. The output route is a segmented control built on native radios. Test tools sit in a collapsed “Essayer sans appel” disclosure.

### Header, transcript and tags

The compact header contains the wordmark on the home screen, or a back control and the view title elsewhere, plus live status and the settings control. Transcript bubbles show the speaker’s name, quieter source text and a stronger translation. Speaker A uses the fill tone; speaker B stays white. The small outlined “Sample” tag identifies demo content without creating a competing accent.

## Do's and Don'ts

### Do:
- **Do** keep the two speaking actions prominent and settings secondary.
- **Do** preserve the charcoal/white state hierarchy and functional red accent.
- **Do** use Inter, quiet dividers, visible keyboard focus and brief motion.
- **Do** retain concise English copy and compact-screen field text of (16px).

### Don't:
- **Don't** add gradients, glass, decorative shadows, illustrations, emojis or slogans to this neutral instrument.
- **Don't** give the two speakers a second brand color. Side and a fill-versus-white bubble are enough in the transcript. The A/B marks stay on the dock.
- **Don't** use red as a routine action or decorative fill.
- **Don't** treat opacity-reduced keyboard hints or development-only overlays as normative text or components.
