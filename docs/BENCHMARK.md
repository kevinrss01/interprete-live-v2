# Benchmark

The **Benchmark** sidebar entry contains the recording tests, floating-caption and
stop-control previews, video-caption checks, and simulated call prompt previously
under Online meeting. It uses the existing incoming/outgoing call controllers,
ASR connection, translation stream, and ordered playback. No provider model or
translation scheduling changes are part of this feature.

## Repeatable procedure

1. Choose **You speak: French / They speak: English**, the NASA recording, and
   whether to generate translated voice. The original recording is muted by default.
2. Run once to inspect the trace. Then repeat at least five times with identical
   settings; keep the network and output route unchanged. Compare completed runs.
3. Inspect the first captions/audio, queue growth, held/revised fragments and errors.
   Select fragments to read the original and translation together. Record omissions,
   repetitions, incorrect numbers or changed meaning in the manual review.
4. Use the French recording or the outgoing test to check the reverse direction.
   These are different fixtures: do not interpret their difference as an optimization.
5. Export the JSON report before clearing results. A change needs repeated before/
   after runs, not a single faster observation. Native capture and longer sessions
   require separate tests; these 23–24 second NASA samples cannot establish stability.

Tests with translation use paid providers. Automated UI verification uses synthetic
capture, fake provider responses and silent playback instead. Accepting a simulated
call prompt can start real capture; its button explains this separately.

## What is measured

- **Input → first captions/audio:** from the first captured PCM frame, including
  opening silence, to controller text availability or client audio receipt. `displayedAt` records
  text committed by the controller, not DOM paint or completion of the word reveal.
  Live text reveals words every 35 ms, compressing large batches into a maximum
  240 ms start window with a 200 ms fade. These presentation delays are not measured
  by the benchmark. Reduced motion and completed history show text immediately.
- **Scheduled voice:** the browser player's scheduled first non-silent sample.
  This is not sound measured at the speaker. Native output does not expose that
  timestamp, so it is unavailable rather than zero.
- **Audio queue:** pending playback seconds sampled during capture and draining.
- **Fragment timeline:** latest ASR update, fragment selection, voice preparation,
  request, first translated text, gate response, first audio, playback and completion.
  Server translation and first-audio durations share their request origin and overlap;
  they must not be added. A zero-ms Jev duration means a local readiness decision.
- **Jev score and availability:** each gate records its readiness probability and
  unavailable flag from the existing server event. The table and fragment details
  distinguish an evaluated score, a failed/unavailable evaluation, a local decision,
  and missing data. The summary counts Jev wait decisions separately from evaluation
  failures; both can hold a fragment. The score measures readiness, not translation
  accuracy. Unavailability includes request failures, timeouts and invalid responses;
  this flag does not identify the underlying provider error.
- **Request → audio median/P90:** completed audio-producing fragments only. Held,
  revised, cancelled and failed attempts remain visible individually. Small runs
  cannot establish reliable tail latency.

The sample has no verified source-word timestamps. These measurements therefore
cannot claim exact word-to-word lag or automatically score translation accuracy.
The API reports model names, not its deployed commit. Comparison checks fixture,
languages, direction, audio settings, output route, API, models and first selected
voice. Matching recorded settings does not control provider load or server version.

## Storage and lifecycle

The last 12 runs are stored locally under `interprete-benchmarks-v1`, outside account
discussion history. Reports contain source/translated text and manual notes, never
recorded audio or signed voice authorizations. Each run is bounded to 500 fragment
attempts and 2,400 queue samples; truncated runs are marked unsuitable for comparison.
Exported JSON contains the selected run and its optional baseline. Clear results
removes this local benchmark history.

Older runs remain readable but have no recorded Jev score or availability flag.
Their wait decisions cannot be retrospectively classified as refusals or evaluation
failures. Repeat the same recording/settings to collect the missing diagnostics.
The added fields are also included in JSON exports; no readiness rule was changed.

Stop, Escape, leaving Benchmark or closing its component ends the run. Session IDs
exclude late/unrelated events. Failed starts remain failures rather than zero-latency
successes. Diagnostics observers cannot interrupt the translation engine.

Starting a new run selects it automatically. Selecting an older run afterward stays
possible while the new one runs, and its updates do not reset that selection.

## Development reloads

React refresh can preserve a controller created before an engine edit. Reload the
app once after installing this fix: subsequent changes to the interpreter module
cancel active controllers, wait for capture and playback cleanup, then reload the
page. These hooks exist only in development. Historical reports are preserved, but
missing gate diagnostics cannot be reconstructed from an older run.

First captions can be a short introductory word. An earlier first caption does not
prove that the same amount of useful content arrived earlier, or that the translation
remained faithful. Review fragment sizes, later gaps and the complete translation
alongside the timing; source-aligned latency still requires annotated fixtures.
