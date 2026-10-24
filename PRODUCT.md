# Interprète

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Tauri 2 desktop app (React, TypeScript, Vite, Tailwind CSS) and a Hono API on a VPS. Cloud speech processing; the app captures and plays audio.

## Users
Two people speaking different languages, taking turns around one shared device. Kevin wants a working low-latency translation app with separate voice identities.

## Product Purpose
Listen to speech, stream a translation, and play translated speech with the lowest practical latency. Measure the real delays.

## Constraints
Research ElevenLabs, Speechmatics, Gladia, OpenAI and alternatives. Evaluate the exact typesafe-ai/jev-1.14.0 model via AI Gateway. Reuse authorized existing provider credentials without exposing them. Deploy to Vercel. No brainstorming, as explicitly requested.

## Delegated decisions
Kevin explicitly delegated technical choices and rejected brainstorming. One shared device, human turn-taking, separate speaker profiles. The translated voice starts during the active person's speech, as early as a usable fragment exists; it must not wait for microphone stop. OpenAI transcription and translation, Jev in parallel, ElevenLabs Flash v2.5 and background voice cloning. Native echo cancellation; exclude generated output from voice-cloning samples. Interface in French, keyboard controls, responsive desktop and mobile. No server-side conversation storage. All automated verification must remain silent on the user's computer.

## Visual commitment
Kevin rejected the first green/orange card-based UI and asked for a much simpler, more minimal, modern interface. A clear, neutral workspace, sparse copy, subtle controls and strong typography. Two speaking actions stay obvious. Voice and cloning settings stay in secondary disclosures. Claude Code with Claude Opus 5.5 at High effort implements this redesign.
