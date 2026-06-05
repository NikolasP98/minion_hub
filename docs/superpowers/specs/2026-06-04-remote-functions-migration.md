# Spec — SvelteKit Remote Functions Migration (minion_hub)

Date: 2026-06-04
Status: in progress
Owner: orchestrator (autonomous)

## Goal

Adopt SvelteKit **experimental remote functions** (`query` / `form` / `command`,
`$app/server`, since SvelteKit 2.27) to delete hand-written client data-fetching
boilerplate in the hub: ~162 `fetch('/api/...')` call sites carrying manual
`JSON.parse`, manual response typing, duplicated request/response types,
loading/error triples, and `invalidate()`/`invalidateAll()` round-trips.

Recon (2026-06-04) classified 120 `/api/**/+server.ts` routes: ~85 (71%) are pure
Drizzle + Better-Auth CRUD — ideal remote-function targets. The rest stay
(gateway WS proxies, SSE/NDJSON streams, server-to-server/internal endpoints,
file upload/binary, crypto/webhook).

## Hard constraints (override the recon where they conflict)

1. **Canonical auth-derived load flow is sacred.** `user`, `permissions`,
   `workspaces`, `personalAgent`, `hosts`, `preferences` flow through
   `(app)/+layout.server.ts` → `page.data` → `invalidate('app:X')`. A remote
   `query` is a *client fetch*; turning the layout bundle into client queries
   would reintroduce the OAuth-callback 401 race the 2026-05-13 refactor removed.
   → **Do NOT migrate the layout bundle reads.** (Drops recon candidates "split
   (app) layout into 5 queries" and "settings/gateways → query" since gateways =
   `hosts` = auth-derived.) Mutations may still `invalidate('app:X')` *after* a
   remote command — that is the documented correct pattern, not the anti-pattern.

2. **WebSocket gateway is untouched.** Chat token streaming, live events,
   presence, flow-run streams, provision SSE — remote functions don't model
   append/streams. Orthogonal channel. Leave as-is.

3. **Keep the green baseline.** `bun run check` 0/0, `bun run test` all pass,
   `bun run build` clean — after every phase.

4. **Experimental risk accepted by owner.** "If the API changes, we'll handle it
   before updating SvelteKit." Pin the SvelteKit minor; watch the changelog.

5. **Concurrency.** Another agent has uncommitted WIP (`gateway.svelte.ts`).
   Scope every commit to this work only. Never `git add -A`.

## Foundation

- `svelte.config.js`: `kit.experimental.remoteFunctions: true` +
  `compilerOptions.experimental.async: true`.
- `src/server/remote/guard.ts`: `currentUser()`, `currentAdmin()`,
  `currentCtx()`, `currentLocals()` — wrap existing `$server/auth/authorize`
  helpers via `getRequestEvent().locals`. Server-only (under `$server`), imported
  inside remote handlers.
- Remote modules live in `src/lib/remote/<domain>.remote.ts` (never in
  `src/lib/server`). Args validated with **zod v4** (already a dep) via Standard
  Schema. Single-flight: server handlers call `void someQuery().refresh()` to
  push fresh data back in the same request.

## Phased rollout (each phase = its own commit, green before moving on)

| Phase | Scope | Types | Notes |
|---|---|---|---|
| 0 | Foundation + **profile pilot** (`/api/me` PATCH) | command | rewire ProfileCard, AvatarUpload; keep `invalidate('app:user')` post-write |
| 1 | **join-requests / join-links** admin | query + command | kills 4× `invalidateAll`; server-driven `.refresh()` |
| 2 | **roles** + permissions catalog | query + command | RolesSection.svelte |
| 3 | **builder** skills/agents/tools | query + command + query.batch | highest fetch density (skill-editor 19 fetches, N+1 chapter-tools → batch) |
| 4 | **marketplace** agents/install/sync | query + command | keep WS file-handoff (`sendInstall`) |
| 5 | **workshop saves**, **chat-history**, **channels** CRUD, **agent-groups** | query + command | delete custom CachedStore |
| 6 | **servers/gateways** CRUD writes (keep hosts *read* as auth-bundle) | form/command | SSRF guard → zod `.refine` |

Routes left as-is: `internal/*`, `messages/ingest`, `metrics/*` push,
`pc/[...path]`, `files` (+`/raw`), `structured-stream`, `voice/tts`,
`device-identity/sign`, `gateway/*`, all `workforce/*` (paperclip proxies),
`flows`/`flow-groups`/`workshop` gateway-RPC paths, AI builder endpoints
(`builder/ai/*`, `marketplace/generate-agent`), `registry/*` (custom cache),
`servers/[id]/token`, provision run/status (SSE).

## Migration recipe (per endpoint)

1. New `*.remote.ts` exporting `query`/`command`/`form` that calls the **same
   service functions** the `+server.ts` already calls (no logic duplication).
2. Zod schema for args (port the inline validation).
3. Auth via `currentUser()/currentAdmin()/currentCtx()`.
4. For mutations that other queries depend on: `void listX().refresh()` server-side.
5. Rewire consumers: replace `fetch(...)` + parse + error state with the imported
   function; drop the manual loading/error/invalidate glue.
6. Keep the old `+server.ts` if any non-browser caller (gateway, external) still
   needs it; otherwise remove once no consumer references it.
7. `bun run check` + targeted `bun run test` green; commit.

## Verification

Per phase: `bun run check` (0/0), relevant vitest, `bun run build`. Manual smoke
via browser-harness on the migrated page (dev server is the `dev` branch).
</content>
</invoke>
