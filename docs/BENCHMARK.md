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
  Live text starts with a 180 ms reserve, then reveals words one at a time with an
  adaptive 48–160 ms interval and a 200 ms fade. Finalization lets queued words finish.
  These presentation delays are not measured by the benchmark. Reduced motion and
  loaded history show text immediately.
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
recorded audio or signed voice authorizations. Each run is bounded to 1200 fragment
attempts and 6000 queue samples; truncated runs are marked unsuitable for comparison.
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

## Current scope

Recording benchmarks use OpenAI only. The incoming English fixture is the NASA
solo recording; French and outgoing synthetic recordings remain available. The
AssemblyAI/Deepgram experiments and three-speaker fixture have been removed.
Existing locally saved reports are preserved as historical measurements.


### Replay context (2026-10-25)

New recording-test exports include ordered `transcripts` snapshots with the client
monotonic timestamp, controller block ID, text, final/revised/replaying flags. Each
segment also records its block ID, source character range in the selected snapshot,
`followingText`, and the exact bounded `precedingSpeech` sent to the readiness model.
Character ranges are diagnostic positions, not stable IDs across ASR revisions and
not source-word audio timestamps. Older exports remain readable but lack this context.

The transcript journal is limited to 2400 snapshots of 4000 characters per run.
Exceeding either limit marks the run truncated, so it must not be treated as a complete
replay. Recording-test text stays in local benchmark history/export, never audio or
provider credentials. The observer does not alter production scheduling.

## Longer multilingual recordings

In Benchmark, choose the source language under **They speak**, then select **Recording**. Four complete ESA videos (English 4:05, French 3:39, Spanish 5:18, German 4:53) complement the short NASA baseline. The target language must differ from the source. Source links, extraction commands and checksums are in `apps/desktop/public/samples/README.md`. These narrated educational videos include music; they are not spontaneous conversation. Compare repeated runs of the same file and settings, not latency across different languages or content.

Per-run trace limits are 1200 segments, 6000 queue samples and 2400 transcript snapshots to accommodate these longer recordings. Limits remain bounded; overflow marks a run incomplete. Local storage may fill sooner with long traces; export results before clearing history.

## Wait breakdown

**Where does the wait happen?** reports median, P90, maximum and sample count for changed transcript-update gaps, completed fragment-publication gaps, request-to-first-text, and additional gate wait after text arrival. Duplicate finalization events for an unchanged item are excluded. Missing legacy traces show a dash. Refused and failed attempts remain in the timeline but are excluded from publication statistics.

These durations overlap and must not be summed. Silence and music affect transcript gaps; no word-aligned recognition or acoustic latency is measured. Publication is controller availability before the progressive animation. Truncated traces are labelled incomplete. Experimental latency scripts that did not justify adoption have been removed; no speculative multi-candidate, look-ahead translation, grouping or alternative translator is enabled.
