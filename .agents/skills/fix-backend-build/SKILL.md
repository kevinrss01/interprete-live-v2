---
name: fix-backend-build
description: Diagnose and fix Interprète Hono API TypeScript, esbuild, or Docker build failures while preserving the desktop RPC contract and server-only secrets.
---

# Fix the API build

Follow [AGENTS.md](../../../AGENTS.md). Reproduce the reported failure with its
actual command; the normal server bundle is `pnpm build:server` from the root.
Read `apps/server/package.json`, `tsconfig.json`, and `Dockerfile` as relevant.

- Distinguish type errors, bundler resolution errors, missing runtime config,
  and Docker/toolchain failures. esbuild does not replace TypeScript checking:
  also run `pnpm --filter @interprete/server typecheck` for server source changes.
- Trace imports through shared contracts and Hono route inference. Use existing
  configuration and transport helpers; keep credential access server-side.
- Fix the underlying cause, preserving validation, CORS, auth, rate limits,
  SSE completion, and WebSocket cancellation. Do not remove checks or bake secrets
  into the image to obtain a successful build.
- Rerun the failing command after changes and relevant server tests. Check the
  desktop typecheck when route types change. If Docker alone fails, inspect its
  build context, lockfile/install step, and runtime entrypoint.

Report the original cause and the exact successful checks. Building an image or
bundle is not a deployment; do not restart a remote service without authorization.
