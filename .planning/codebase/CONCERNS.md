# Codebase Concerns

**Analysis Date:** 2026-03-05

## Tech Debt

**Hardcoded default encryption key:**
- Issue: `src/server/auth/crypto.ts` line 8 falls back to `'minion-hub-dev-key'` when `ENCRYPTION_KEY` env var is missing. This means tokens are "encrypted" with a publicly known key in any deployment that forgets to set the var.
- Files: `src/server/auth/crypto.ts`
- Impact: Server tokens stored in the DB can be decrypted by anyone who reads the source code if the operator does not set `ENCRYPTION_KEY`.
- Fix approach: Fail hard on startup if `ENCRYPTION_KEY` is not set in production (check `NODE_ENV`). Log a clear error message.

**Static salt for key derivation:**
- Issue: `scryptSync(raw, 'minion-hub-salt', 32)` uses a fixed, publicly visible salt. This weakens key derivation since all deployments share the same salt.
- Files: `src/server/auth/crypto.ts` line 9
- Impact: Reduces the security margin of encryption at rest.
- Fix approach: Generate a random salt on first startup, persist it alongside the DB, and load it at runtime.

**`process.env` used directly instead of SvelteKit `$env`:**
- Issue: Several server-side files access `process.env` directly instead of using `$env/dynamic/private`, bypassing SvelteKit's env handling and type safety.
- Files: `src/server/auth/crypto.ts`, `src/server/storage/b2.ts`, `src/server/seed.ts`, `src/routes/api/marketplace/generate-agent/+server.ts`
- Impact: No compile-time detection of missing env vars; inconsistent env access patterns across the codebase.
- Fix approach: Replace all `process.env.*` references in server code with `import { env } from '$env/dynamic/private'`. Reserve `process.env` for test setup files only.

**Pervasive silent error swallowing:**
- Issue: 102 `catch {}` / `.catch(() => {})` blocks across 52 files silently discard errors with no logging. Many are marked `/* non-critical */` but some suppress failures that could mask real bugs (e.g., DB writes, WS requests).
- Files: `src/lib/services/gateway.svelte.ts` (12 instances), `src/lib/state/workshop.svelte.ts` (9 instances), `src/lib/workshop/gateway-bridge.ts` (7 instances), and dozens more.
- Impact: Debugging production issues is difficult when errors vanish silently. Users see no feedback when operations fail.
- Fix approach: Add `console.warn` or structured logging to every catch block. Keep non-critical errors non-throwing but make them observable.

**Widespread `as never` type casts:**
- Issue: `as never` is used as a type escape hatch in `src/lib/services/gateway.svelte.ts` (5 instances) to push untyped gateway payloads into typed arrays/functions.
- Files: `src/lib/services/gateway.svelte.ts` lines 421, 423, 442, 443, 541
- Impact: Bypasses TypeScript's type checker entirely, hiding potential runtime type mismatches.
- Fix approach: Define proper types for chat messages and presence payloads. Replace `as never` with validated type guards or explicit interfaces.

**No input validation library:**
- Issue: API route handlers perform ad-hoc manual validation (`if (!b.email || typeof b.email !== 'string')`). No schema validation library (Zod, Valibot, etc.) is used.
- Files: All 41 route handlers in `src/routes/api/`
- Impact: Inconsistent validation, easy to miss edge cases (string length, format, injection), verbose handler code.
- Fix approach: Adopt Zod or Valibot for request body parsing. Create shared schemas per resource.

## Security Considerations

**API routes lack role-based authorization:**
- Risk: Only `src/routes/api/servers/[id]/+server.ts` checks `user.role !== 'admin'` for DELETE/PUT. All other API routes (users, marketplace, settings, bugs, files, workshops, flows) only check `locals.tenantCtx` (i.e., "is there a tenant?"). Any authenticated user can create users, change roles, delete users, modify server configs, etc.
- Files: `src/routes/api/users/+server.ts`, `src/routes/api/users/[id]/+server.ts`, `src/routes/api/servers/[id]/settings/[section]/+server.ts`, `src/routes/api/files/+server.ts`, `src/routes/api/flows/+server.ts`
- Current mitigation: Single-tenant deployments where all users are trusted.
- Recommendations: Add a `requireRole('admin')` helper and apply it to destructive endpoints (user management, server config, file deletion). Apply least-privilege by default.

**Unauthenticated API fallback pattern:**
- Risk: When `AUTH_DISABLED` is not set, the hooks still fall back to the first org for any `/api/` request without a session (lines 102-107 of `src/hooks.server.ts`). This means unauthenticated API requests succeed with the first tenant's context.
- Files: `src/hooks.server.ts` lines 102-108
- Current mitigation: Intended for local single-user setups.
- Recommendations: Make the fallback opt-in via an explicit env var (e.g., `ALLOW_ANONYMOUS_API=true`). Default to rejecting unauthenticated API requests.

**No rate limiting:**
- Risk: No rate limiting on any endpoint. The `/api/marketplace/generate-agent` endpoint proxies to Anthropic API and could be abused to run up costs.
- Files: All `src/routes/api/` endpoints, especially `src/routes/api/marketplace/generate-agent/+server.ts`
- Current mitigation: None.
- Recommendations: Add rate limiting middleware (e.g., per-IP or per-user token bucket) at minimum on the agent generation endpoint and auth endpoints.

**No CORS configuration:**
- Risk: SvelteKit's default CORS handling applies. No explicit CORS policy is configured. If the app is deployed behind a reverse proxy that adds permissive CORS headers, cross-origin requests could access API endpoints.
- Files: No CORS configuration files found.
- Current mitigation: SvelteKit same-origin default.
- Recommendations: Explicitly configure CORS in hooks if the app will be accessed cross-origin.

**Bearer token auth scans all servers:**
- Risk: `resolveServerTokenAuth` in `src/hooks.server.ts` fetches ALL server rows and decrypts every token to find a match. This is O(n) in total server count across all tenants, and leaks timing information.
- Files: `src/hooks.server.ts` lines 18-43
- Current mitigation: Comment says "Server count per tenant is small (<10)".
- Recommendations: Store a token hash alongside the encrypted token for O(1) lookup. Only decrypt after hash match.

## Performance Bottlenecks

**Workshop module complexity:**
- Problem: The workshop subsystem consists of three oversized files that are tightly coupled and difficult to modify independently.
- Files: `src/lib/workshop/gateway-bridge.ts` (1520 lines), `src/lib/components/workshop/WorkshopCanvas.svelte` (1586 lines), `src/lib/state/workshop.svelte.ts` (943 lines)
- Cause: The gateway bridge manages orchestration loops, FSM events, inbox handling, conversation management, and tool-call processing in a single file. The canvas component handles rendering, input, drag-drop, and UI overlays monolithically.
- Improvement path: Extract gateway-bridge into smaller modules: orchestration-loop, tool-call-handler, inbox-handler. Extract WorkshopCanvas into sub-components for toolbar, context menus, and overlay panels.

**30-second polling interval for agents/sessions:**
- Problem: `src/lib/services/gateway.svelte.ts` polls `agents.list` and `sessions.list` every 30 seconds via `setInterval`, even when there is no activity.
- Files: `src/lib/services/gateway.svelte.ts` lines 560-577
- Cause: The gateway pushes events for changes but there is no guarantee of delivery (event gaps are logged but not recovered).
- Improvement path: Implement server-side push for agent/session list changes, or use exponential backoff polling that speeds up when activity is detected.

## Fragile Areas

**Gateway WebSocket message handling:**
- Files: `src/lib/services/gateway.svelte.ts` lines 296-347
- Why fragile: All inbound WS messages flow through `handleMessage` which does a JSON parse and dispatches by `frame.type`. Payloads are cast with `as Record<string, unknown>` and `as ChatEvent` without validation. A malformed payload from the gateway could cause silent data corruption.
- Safe modification: Add runtime validation for event payloads before dispatching. Use discriminated union types.
- Test coverage: No tests exist for gateway message handling.

**Workshop conversation orchestration:**
- Files: `src/lib/workshop/gateway-bridge.ts`
- Why fragile: The orchestration loop (`runOrchestrationLoop`) manages multi-agent turn-taking via sequential `sendRequest` calls with complex state tracking. Race conditions are possible if two conversations start simultaneously for the same agent. Guard logic exists (line 427) but relies on mutable state.
- Safe modification: Add integration tests for the orchestration loop. Consider a state machine for conversation lifecycle.
- Test coverage: No tests.

**Marketplace page components:**
- Files: `src/routes/marketplace/agents/[slug]/+page.svelte` (1318 lines), `src/routes/marketplace/agents/+page.svelte` (784 lines), `src/lib/components/marketplace/AgentCard.svelte` (807 lines)
- Why fragile: These are very large single-file components mixing data fetching, complex UI state, animations, and business logic. Any change risks unintended side effects.
- Safe modification: Extract data-fetching logic into state modules. Break AgentCard into smaller sub-components.
- Test coverage: No tests.

## Test Coverage Gaps

**Frontend code is entirely untested:**
- What's not tested: All Svelte components, all state modules (`src/lib/state/*.svelte.ts`), the gateway service, all workshop logic, all utility functions beyond the 4 tested ones.
- Files: `src/lib/state/`, `src/lib/services/`, `src/lib/workshop/`, `src/lib/components/`, `src/routes/`
- Risk: UI regressions, state management bugs, and WebSocket protocol changes go undetected.
- Priority: High

**Only 7 test files for 22 service files:**
- What's not tested: `src/server/services/marketplace.service.ts`, `src/server/services/activity-bins.service.ts`, `src/server/services/chat.service.ts`, `src/server/services/connection.service.ts`, `src/server/services/credential-health.service.ts`, `src/server/services/device-identity.service.ts`, `src/server/services/reliability.service.ts`, `src/server/services/session.service.ts`, `src/server/services/agent.service.ts`, `src/server/services/settings.service.ts` (and others)
- Files: `src/server/services/`
- Risk: Database interaction bugs, data integrity issues in untested services.
- Priority: Medium

**No API route handler tests:**
- What's not tested: 41 API route handlers have no integration tests (except `src/routes/api/metrics/push/push.test.ts`). Auth bypass, input validation, and error handling paths are unverified.
- Files: `src/routes/api/`
- Risk: Auth bugs, broken endpoints, silent data corruption from malformed requests.
- Priority: High

**No E2E tests:**
- What's not tested: Full user flows (login, connect to gateway, manage agents, workshop interactions).
- Files: No Playwright/Cypress config found.
- Risk: Integration failures between frontend and backend go undetected.
- Priority: Medium

## Dependencies at Risk

**PixiJS 8 + Rapier2D in workshop:**
- Risk: Heavy dependencies (~1MB+ combined) loaded for the workshop canvas feature. PixiJS 8 is relatively new and the API may have breaking changes.
- Impact: Bundle size, potential compatibility issues on updates.
- Migration plan: Consider lazy-loading the workshop module only when the user navigates to it. Pin PixiJS version tightly.

## Missing Critical Features

**No database migrations in CI:**
- Problem: Schema changes use `db:push` (destructive sync) rather than proper migrations for production.
- Blocks: Safe production deployments with data preservation.

**No structured logging:**
- Problem: All logging uses bare `console.log`/`console.error`/`console.warn`. No structured format, no log levels, no correlation IDs.
- Blocks: Production debugging, log aggregation, alerting.

---

*Concerns audit: 2026-03-05*
