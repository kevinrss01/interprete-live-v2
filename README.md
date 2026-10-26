# Interprète

Live speech translation for conversations and calls on Mac.

Choose **Conversation** (two people, one device) or **Online meeting**. Meeting mode detects calling apps using the microphone or camera, including in the waiting room, and offers a confirmation above other apps. It can show live captions for other participants at the bottom of the screen (enabled by default), read their translation aloud in a similar voice chosen by Jev, and send your translated microphone audio to the **Interprete** virtual microphone (through BlackHole 2ch). A headphone mode and synthetic samples let you test without a meeting. See the [setup and testing guide](docs/CALL-MODE.md).

**Turn on translation** restores your settings and can switch the system microphone automatically; stopping restores the previous microphone. Select **System / Default** in your calling app to follow these changes.

On first setup on Mac, **Get your Mac ready** guides you through microphone access, call audio access, Meet mute-button access, and virtual microphone installation. The official BlackHole 2ch installer is downloaded, verified, and opened in macOS Installer. Setup resumes after a restart and remains available under **Settings → Permissions → Review Mac setup**. You can defer it to use in-person conversation; each call translation direction checks its prerequisites before starting.

Conversation mode translates speech for two people taking turns on **one shared device**. The desktop app uses [Tauri 2](https://v2.tauri.app), React, TypeScript, Vite, and Tailwind CSS, with a [Hono](https://hono.dev) API that can run on Vercel or a VPS. The interface is in English, including language selectors and accessibility labels. Reading passages, voice previews, transcripts, and translations use their selected speech language.

```
apps/desktop     Tauri app: React frontend (static export) + Rust shell (src-tauri)
apps/server      Hono API (Node): OpenAI / ElevenLabs keys, signed sessions, Docker deployment
apps/landing     Static landing page (Vite), deployed on Vercel
packages/shared  Shared types, languages, and segmentation
packages/ui      Design system: shadcn components, CSS tokens, logos
scripts/         Benchmarks and verification outside the app
```

## Getting started

Prerequisites: Node 22+, the pnpm version in `package.json`, Docker running with Compose, and Rust ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env.local   # fill in the secrets
cp apps/desktop/.env.example apps/desktop/.env.local # VITE_API_URL
pnpm dev          # PostgreSQL + migrations + API + Studio + macOS Tauri app
```

After the initial setup, `pnpm dev` starts everything from the repository root. The backend is available at `http://localhost:3035`, Vite at `http://localhost:1420`, and Studio at https://local.drizzle.studio. `Ctrl+C` stops the development processes and PostgreSQL container while preserving its volume and data. Use `pnpm dev:server` and `pnpm dev:desktop` to start each part separately; `pnpm --filter @interprete/desktop dev:web` starts Vite alone.

In **Conversation**, choose both languages and press **Turn on microphone** for the person speaking. The microphone status stays visible above the controls. Translation starts during speech, in small segments, without waiting for the microphone to stop. The microphone stays open during pauses and playback; **Mute microphone** ends the turn. The **A**, **B**, and **Esc** keys also control the session.

**Audio sample** uses a synthetic recording to test the pipeline without a microphone. It is never used for cloning. A floating card on the right of the screen shows the current session and lets you stop it from any application. In **Online meeting**, **Show translation card** previews it without opening the microphone.

If local account creation fails, check `DATABASE_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` in `apps/server/.env.local`, including in each new worktree. The secret must contain at least 32 characters; generate it once with `openssl rand -base64 32`. `pnpm dev` and `pnpm dev:server` validate this configuration before starting services. Restart the server after editing the file so it reloads the variables.

## Architecture

Detailed documentation and diagrams: [docs/architecture.md](docs/architecture.md).

```mermaid
flowchart LR
  Micro[Browser microphone] --> ASR[OpenAI · gpt-live-transcribe]
  ASR --> Text[Partial and final text]
  Text --> Translate[OpenAI · gpt-5.4-mini]
  Text --> Decider[Decider v1.2 · AI Gateway]
  Translate --> Speech[ElevenLabs Flash v2.5]
  Decider --> Buffer[Approve the next fragment]
  Buffer --> Speech
  Speech --> Audio[Playback during speech]
  Micro -->|With consent, in parallel| Clone[ElevenLabs Instant Voice Cloning]
  Clone -->|From the next segment| Speech
```

- Tauri bundles only a static frontend. All server logic (keys, SSE, ElevenLabs WebSocket) lives in `apps/server`. The app obtains a signed session from `/api/status`, keeps it in local storage, and sends it as `Authorization: Bearer`. The server accepts only origins in `ALLOWED_ORIGINS` (CORS in `apps/server/src/app.ts`).
- The frontend calls the API through Hono's typed RPC client (`hc<AppType>` in `apps/desktop/src/lib/api.ts`). Request and response types come from the server routes, so a route change breaks desktop compilation rather than the running app.
- The webview captures 24 kHz PCM in 20 ms frames and connects to OpenAI using an ephemeral token from `/api/session`. Capture and connection start in parallel; initial frames wait in memory until the connection is ready. Permanent keys stay on the server.
- `/api/interpret` streams translation and communicates with ElevenLabs over WebSocket. Audio returns to the client over SSE.
- OpenAI uses `gpt-live-transcribe` with `delay: minimal`. Its deltas are split into lexical fragments; Decider estimates when a fragment can be translated without waiting for a complete sentence. Look-ahead context helps wait for negations or incomplete numbers. Readiness decisions do not guarantee transcription accuracy or translation quality. Jev selects similar voices for call participants. Model configuration lives in `apps/server/src/lib/config.ts`.
- ASR items finalize separately every 30 seconds or during a pause, without stopping capture. Final transcripts are associated with their `item_id`. Connections renew after 45 minutes, with a second connection prepared in parallel; reconnection replays the unfinalized buffer (up to 60 seconds). Longer outages are reported.
- Each approved segment is immediately sent to speech synthesis. Audio packets play as they arrive, in order, while the microphone stays open. The spoken-word cursor avoids replaying the full sentence on finalization. The remaining portion is translated when the turn ends.
- Browser echo cancellation is enabled (`all` mode when available). Its acoustic effectiveness depends on the browser, microphone, and speaker volume. Clone collection excludes audio playback periods and produces small WAV files while the microphone continues.
- Each profile has its own language, voice, and samples. Cloning starts in the background after about 30 seconds of authorized speech, or manually after 10 seconds. The temporary voice remains available during creation; the clone is used from the next available segment. A clone requiring additional verification is not activated.
- A cloning retry first searches for the voice already created for that consent, profile, and session. This recovers a lost network response without reusing a previous person's voice.

PostgreSQL and Drizzle store Better Auth accounts, preferences, and discussion text through oRPC. Email/password sign-up and sign-in are connected to the frontend. Discussion history is stored per account, including spoken time and last update, and cached on the device; retention is limited to 50 discussions and 200 messages per discussion. Playback audio is not stored on the server. The live interpreter retains the latest 30 turns and three replay clips in memory. Speaker A's cloned voice ID is stored per account and authorized for the current device session at login; other preferences and speaker B's voice remain local. Cloned voices are hosted by ElevenLabs until deletion; providers apply their own retention policies to requests.

## Accounts and preferences

The [backend guide](docs/backend.md) describes routing, checks, available procedures, migrations, and frontend integration.

```sh
# Set DATABASE_URL, BETTER_AUTH_URL, and BETTER_AUTH_SECRET in apps/server/.env.local.
pnpm dev:server
```

This command waits for PostgreSQL, applies migrations, then starts the API with reloading and Studio. The example configuration uses PostgreSQL at `localhost:5436`. Local Compose credentials are for development only. Advanced users can run the server alone with `pnpm --filter @interprete/server dev`.

Studio is already started by `pnpm dev:server`: open https://local.drizzle.studio. Use `pnpm db:studio` to start Studio alone against an already running database. Database commands use `DATABASE_URL` from `apps/server/.env.local`.

After changing `apps/server/src/db/schema.ts`, run `pnpm --filter @interprete/server db:generate`, review and commit the files in `apps/server/drizzle/`, then run `pnpm --filter @interprete/server db:migrate`.

In production, provide a PostgreSQL URL reachable from the container, a public HTTPS URL in `BETTER_AUTH_URL`, and a secret distinct from `SESSION_SECRET`. Build the image, apply migrations once, then start the API:

```sh
API_DOMAIN=api.example.com docker compose build api
API_DOMAIN=api.example.com docker compose run --rm api node dist/db/migrate.mjs
API_DOMAIN=api.example.com docker compose up -d
```

Account authentication uses a Better Auth bearer token stored separately from the anonymous `interprete-session` token. The current Tauri client keeps the account token in webview local storage; moving it to the native keychain remains future work.

## Server variables

| Variable | Purpose |
| --- | --- |
| `INTERPRETER_OPENAI_API_KEY` | OpenAI transcription and translation |
| `ELEVENLABS_API_KEY` | Speech synthesis, voice inventory, creation, and deletion |
| `AI_GATEWAY_API_KEY` | Decider readiness checks and Jev voice matching; final translation also works without this service |
| `SESSION_SECRET` | Signs anonymous sessions and voice grants; use a long random value |
| `DATABASE_URL` | PostgreSQL connection for accounts, preferences, and discussion text |
| `BETTER_AUTH_URL` | Public API URL; HTTPS in production |
| `BETTER_AUTH_SECRET` | Separate authentication secret, at least 32 characters |
| `ALLOWED_ORIGINS` | Allowed origins (default: `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`) |

On desktop, `VITE_API_URL` (in `apps/desktop/.env.local`) is embedded at build time: point it to the API's HTTPS URL before running `pnpm build:desktop`.

The ElevenLabs key must allow voice inventory reads, text-to-speech, and voice management. Never prefix server secrets with `VITE_` or `NEXT_PUBLIC_`, commit them, or include their values in reports.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:server
pnpm --filter @interprete/desktop build # static app build
pnpm --filter @interprete/landing build
pnpm build:desktop   # native .app / .dmg / .msi bundle, depending on the platform
pnpm build:desktop:dmg # on macOS: Apple Silicon DMG, without GitHub publication
```

Root lint currently covers the server only. Server tests also cover oRPC routing and unauthenticated request rejection without requiring a database. The integration test applies migrations and creates/deletes its own users; use a dedicated database:

```sh
TEST_DATABASE_URL=postgresql://interprete:interprete@localhost:5436/interprete_test pnpm --filter @interprete/server test:db
```

Create `interprete_test` in the local PostgreSQL instance first. This test uses real Better Auth sessions without calling AI providers.

Tests cover signatures, voice separation, consent, incomplete streams, playback before capture stops, no final repetition, and parallel startup. `pnpm exec tsx scripts/verify-live-app.ts <synthetic-24khz.wav>` is a silent live-API check without speaker output; inspect its auth and transport against the current implementation before using it. Older benchmark scripts remain in `scripts/`; they use paid services and are not run by app tests. Automated verification must use synthetic input and mocked or silent playback, without recording a real microphone.

See the [recorded verification results](docs/VALIDATION.md). Demo latency observations cover a few sentences; they are not representative benchmarks across all languages and network conditions.

## Deployment

### macOS download and automatic releases

The [landing page](https://tryinterprete.com) offers a public Apple Silicon DMG download without a GitHub account. Source code and reference releases remain in the private repository. The public file is hosted in the Vercel Blob store `interprete-downloads`, attached to the `interprete-landing` project.

Every **push to `main`** triggers the [Release macOS](.github/workflows/release-macos.yml) workflow. It checks configuration and tests, builds the DMG, publishes a GitHub release tagged `v<version>-build.<workflow-run-number>.<attempt>`, then replaces the public download. You do not need to bump the version for every push. Builds are serialized and obsolete commits are not published; if a build fails, the previous public file stays available. The file cache is limited to 60 seconds.

Publication configuration:

- GitHub Actions: `VITE_API_URL` variable with the production API's HTTPS URL, and `DOWNLOAD_PUBLISH_SECRET` secret.
- Vercel project `interprete-landing`: the same server-side `DOWNLOAD_PUBLISH_SECRET`, a `BLOB_STORE_ID` variable, and OIDC authentication enabled. Neither server-side value should be prefixed with `VITE_`.
- `POST /api/publish-download` checks the secret, then issues an upload URL valid for 10 minutes and limited to the DMG (100 MiB maximum). The upload goes directly to Blob without passing the file through a Function. Store credentials stay on Vercel.

Use `pnpm release` to manually trigger a stable `v<version>` release from `main`. First bump the version in `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and the package entry in `Cargo.lock`, then push. The workflow rejects an already published stable version. Follow **Actions → Release macOS**; no additional publication click is needed.

The release is prepared as a draft during upload, then published and marked as latest. If public download publication fails after the GitHub release, the workflow fails and the previous public file stays available. Rerun the automatic workflow (the attempt gets a new tag), or republish that DMG with `scripts/publish-download.mjs`. This workflow does not deploy the backend. Downloading a new build does not automatically update installed apps.

The permanent public link is `https://h7ddt3inb3wj86c7.public.blob.vercel-storage.com/Interprete-macOS-arm64.dmg?download=1`. The landing page and footer share this link. The app bundle is explicitly ad-hoc signed (`signingIdentity: "-"`), sealing its resources and including the microphone entitlement. Before publication, `scripts/verify-macos-dmg.sh` mounts the DMG read-only and checks image integrity, the bundle signature, app identity, and microphone entitlement. A linker signature on the executable alone is insufficient: it caused the “damaged and can’t be opened” warning in the 25 October 2026 download.

Ad-hoc signing does not replace a **Developer ID Application** certificate and Apple notarization. Until these are configured, macOS may still block the app: copy it to **Applications**, then explicitly allow it in **System Settings → Privacy & Security → Open Anyway**. Do not disable Gatekeeper globally.

Locally, `pnpm build:desktop:dmg` rebuilds the DMG with the existing icons and Tauri settings without creating a tag or release. Configure `VITE_API_URL` in `apps/desktop/.env.local` before building; the terminal reports the output path. Target: macOS 14.2 or later, Apple Silicon. Verify the result with `bash scripts/verify-macos-dmg.sh <path-to-dmg>`; notarization remains unconfigured.

The DMG background and icon positions are configured in `bundle.macOS.dmg`. To change the visual, edit `apps/desktop/src-tauri/dmg/background.swift`, then run `swift apps/desktop/src-tauri/dmg/background.swift` on macOS to regenerate the PNG before rebuilding the DMG. No additional drawing tool is required.

### Hosting

- **Landing (Vercel)**: [tryinterprete.com](https://tryinterprete.com) serves `apps/landing` and the social sharing image used by the site and app. See [social sharing metadata](docs/social-preview.md).
- **Web (Vercel)**: [app.tryinterprete.com](https://app.tryinterprete.com) serves the Vite build of `apps/desktop` (`dist/`). The build variable `VITE_API_URL=https://api.tryinterprete.com` connects the Hono and oRPC clients to the shared backend. `apps/desktop/vercel.json` preserves app routing on reload. The project is connected to GitHub repository `kevinrss01/interprete-live-v2`: pushes to `main` deploy production; other branches create previews. Vercel blocks deployments whose commit author is not a member of the VoiceCheap team. `www` and older web/landing addresses redirect through Vercel Domains settings; the old API address remains available to previously distributed macOS apps.
- **API (Vercel)**: `interprete-backend` uses `apps/server`, the Frankfurt region, and the Neon database `interprete-postgres`. Like the web app, it is connected to the repository with `main` as its production branch; a frontend release must not leave the API on an older manual deployment. `pnpm --filter @interprete/server build:vercel` generates `dist/app.mjs`; `apps/server/app.mjs` exposes it to the Hono runtime without starting a standalone server. Provider keys and session secrets remain exclusively in server variables. `BETTER_AUTH_URL` must match the API domain, and `ALLOWED_ORIGINS` must include allowed web domains. Apply migrations through the Neon connection before releasing code that needs new tables. Migrations are not run automatically by the Vercel build.
- **API (VPS)**: copy the repository and `apps/server/.env.local` to the server, then run `API_DOMAIN=api.example.com docker compose up -d --build`. Caddy obtains the HTTPS certificate and proxies SSE without buffering. The image includes the ESM bundles `dist/server.mjs`, `dist/db/migrate.mjs`, and SQL migrations. Configure PostgreSQL and follow the [deployment steps](docs/backend.md#déployer) for accounts. Use a single instance: request limits are in memory.
- **Desktop**: `pnpm build:desktop`. On macOS, `Info.plist` declares microphone use and `Entitlements.plist` authorizes it under the hardened runtime; signing and notarization are configured separately.

Voice conversation works in the browser with microphone permission. Mac call detection, floating windows outside the browser, and the virtual microphone require the Tauri app. Request limits remain in memory per instance; Vercel deployment does not turn them into distributed quotas.

After an API release, verify the actual runtime with a dedicated disposable QA account whose server history is empty. Keep that account idle during verification: saving a discussion enforces the app's history retention limit. The checker refuses to write when existing history is present. Store its email and password in a private JSON file outside the repository; do not pass credentials on the command line:

```sh
pnpm verify:deployment --url https://api.tryinterprete.com \
  --origin https://app.tryinterprete.com \
  --account-file /absolute/path/to/private-qa-account.json \
  --revision "$(git rev-parse origin/main)"
```

This explicitly invokes live translation with synthetic text and checks that captions-only mode returns no audio. It verifies the account voice route, rejects an invalid voice grant, and saves/loads a synthetic discussion through a fresh login before removing only that discussion. It never opens a microphone or plays audio. `--keep-discussion` retains the synthetic row for browser inspection. `/api/status` reports the deployed Git revision, or `null` outside a Git deployment, so the check can reject a stale runtime.

Cloning a real voice requires that person's consent and a clean sample. The two people always take turns; only synthetic translation overlaps speech. Automatic speaker identification and separation of two simultaneous human voices are not supported.

References: [OpenAI continuous transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [ElevenLabs streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts).

## Development agents

[AGENTS.md](AGENTS.md) contains project rules and verification commands;
[CLAUDE.md](CLAUDE.md) loads the same guide for Claude Code.
The [skill catalog](docs/agent-skills.md) covers commits and PRs, reviews,
builds, dependencies, UI, Rust, and audio pipelines.
The [ship-and-merge](.agents/skills/ship-and-merge/SKILL.md) skill is shared with Codex and Claude Code.
Invoke it explicitly with `$ship-and-merge` or `/ship-and-merge` to publish and merge
the task PR after verification. Manual deployment remains a separate action.
