# Call audio and mute implementation plan

**Goal:** Receive call audio without silencing a failed capture, keep capture errors visible in captions, and stop outgoing processing when Meet is muted.

**Architecture:** Start the CoreAudio tap unmuted and mute the original only during translated playback. Refresh the process selection as browser audio helpers change. Read only the call's microphone control through macOS Accessibility; an outgoing session pauses on mute or unreadable state, retaining the virtual microphone route so the system never falls back to a physical microphone during a pause.

**Tech stack:** Existing React 19/TypeScript, Tauri 2/Rust 2024, CoreAudio, ApplicationServices. No additional runtime dependency.

**Constraints:** English UI; synthetic, silent verification; no automatic permission grants; preserve account/voice ownership and cancellation; preserve unrelated package edits. Work locally; publication is outside this request.

## Incoming audio

- [x] Update `system_audio.m` to refresh matching process IDs and expose `interprete_tap_mute(handle, muted)` using `kAudioTapPropertyDescription`.
- [x] Expose a session-scoped native mute command. `SystemAudioCapture.setOutputActive(active)` serializes changes, never mutes before playback and ignores late changes after stop.
- [x] Keep silence diagnostics and their next action visible in native/browser captions. Check no capture means no mute, active translated playback mutes, silence/error restores original, and stale commands cannot affect a newer tap.

## Outgoing mute

- [x] Add `call_microphone_state(source)` returning `{ muted: boolean | null, permissionRequired: boolean, supported: boolean }`. Limit read-only Accessibility traversal to the selected call application's windows and require a recognizable call control, never a participant's mute control.
- [x] Add a session owner which polls without overlap, suspends the controller on mute/unknown state, and resumes only after confirmed unmute. Stop invalidates pending polls and resumes.
- [x] Retain the virtual output and system-input lease during suspension; clear queued PCM before resuming. Test mute during startup, delayed replies after stop, failed reads, cancellation, and no queued audio crossing the mute boundary.

## Verification and delivery

- [x] Run focused TypeScript tests and Rust tests first, then project typecheck/lint/tests/server+desktop builds, Cargo fmt/check/Clippy and native bundle.
- [x] Inspect synthetic UI states and native read-only mute diagnostics; do not capture a real microphone, emit test audio into the active call, or grant OS permissions.
- [x] Review the complete diff, update `CALL-MODE.md`, architecture and validation notes with actual checks and unverified live boundaries.

Execute inline in this session. No commit, push, deployment, or live provider test is required.

Validation details and the pre-existing global rustfmt exception are recorded in `docs/VALIDATION.md`. Live acoustic reception remains for a user-run call test.
