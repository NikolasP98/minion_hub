# External Integrations

**Analysis Date:** 2026-03-05

## APIs & External Services

**Gateway WebSocket (core integration):**
- Custom JSON frame protocol over WebSocket to remote AI agent gateway servers
- Client: `src/lib/services/gateway.svelte.ts`
- Frame types: `req` (request), `res` (response), `event` (push)
- Auth: Challenge/response handshake with Ed25519 device signatures + bearer token
- Gateway URLs stored per-host in `src/lib/state/hosts.svelte.ts` (persisted in SQLite via `/api/servers`)
- Reconnect with exponential backoff (800ms base, 15s max, 1.7x factor)

**GitHub API:**
- Used for marketplace agent catalog sync
- Client: `src/server/services/marketplace.service.ts`
- Endpoint: `https://api.github.com` (GitHub REST API v3)
- Repo: `NikolasP98/minions` (hardcoded in `GITHUB_REPO` constant)
- Auth: Optional `GITHUB_TOKEN` env var (Bearer token); works without for public repos (rate-limited)
- Operations: List agent directories, fetch `agent.json` metadata, lazy-load markdown files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `CONTEXT.md`, `SKILLS.md`)
- Caching: 1-hour TTL on catalog sync (`CATALOG_TTL_MS`), markdown cached in SQLite after first load

**Vercel Analytics:**
- Client-side only, injected in `src/routes/+layout.ts`
- Package: `@vercel/analytics` (SvelteKit integration)
- No server-side env vars required

## Data Storage

**Database:**
- SQLite via libSQL/Turso
- Connection: `TURSO_DB_URL` env var (defaults to `file:./data/minion_hub.db` for local dev)
- Auth token: `TURSO_DB_AUTH_TOKEN` env var (required for remote Turso only)
- Client: Drizzle ORM singleton at `src/server/db/client.ts` via `getDb()`
- Schema: `src/server/db/schema/` (one file per table)
- Tables: `servers`, `agents`, `sessions`, `session-tasks`, `tasks`, `missions`, `bugs`, `files`, `settings`, `skills`, `skill-execution-stats`, `reliability-events`, `credential-health`, `gateway-heartbeats`, `connection-events`, `activity-bins`, `chat-messages`, `config-snapshots`, `marketplace-agents`, `marketplace-installs`, `device-identities`, `user-servers`, `workshop-saves`, `flows`
- Multi-tenant: All service functions take `TenantContext` (`{ db, tenantId }`)

**File Storage:**
- Backblaze B2 (S3-compatible)
- Client: `src/server/storage/b2.ts` using `@aws-sdk/client-s3`
- Endpoint: `B2_ENDPOINT` env var (e.g., `https://s3.us-west-004.backblazeb2.com`)
- Bucket: `B2_BUCKET_NAME` env var (default: `minionhub`)
- Auth: `B2_KEY_ID` + `B2_APP_KEY` env vars
- Operations: `uploadToB2()`, `getSignedDownloadUrl()` (1hr presigned), `deleteFromB2()`
- Optional - only needed for file upload features

**Caching:**
- No external cache service
- In-memory: WebSocket connection state, pending request map, gateway data (`$state` runes)
- localStorage: Workshop canvas state (auto-saved), last active host ID, sparkline style preferences, theme
- SQLite: Activity bins (30s flush interval), marketplace catalog (1hr TTL)

## Authentication & Identity

**Auth Provider:**
- Better Auth (`better-auth` v1.4.19)
- Implementation: `src/lib/auth.ts` (server-side singleton)
- Adapter: Drizzle (SQLite) via `better-auth/adapters/drizzle`
- Plugins: JWT, Organization (multi-tenant)
- Session handling: `src/hooks.server.ts` reads session from request headers via `getAuth().api.getSession()`

**Auth Methods:**
- Email + Password: Enabled by default
- Google OAuth: Optional, requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
- Bearer server token: For gateway-to-hub metrics push (`/api/metrics/*`); tokens encrypted at rest with AES-256-GCM (`src/server/auth/crypto.ts`)
- `AUTH_DISABLED=true`: Bypasses all auth (for CI/test)

**Auth Routes:**
- `src/routes/api/auth/[...all]/+server.ts` - Catch-all delegated to Better Auth handler
- Better Auth owns all `/api/auth/*` paths

**Device Identity:**
- Ed25519 key pair generated per tenant for WebSocket device auth
- Service: `src/server/services/device-identity.service.ts`
- API: `src/routes/api/device-identity/sign/+server.ts`
- Stored in `device_identities` table (public + private key PEM)
- Signs challenge nonces for gateway handshake

**Token Encryption:**
- AES-256-GCM for server tokens at rest
- Implementation: `src/server/auth/crypto.ts`
- Key derivation: scrypt from `ENCRYPTION_KEY` env var (falls back to deterministic dev key)

## Monitoring & Observability

**Error Tracking:**
- No external service (Sentry, etc.)
- Global error handler in `src/hooks.server.ts` (`handleError`) logs to `console.error`

**Logs:**
- `console.log` / `console.error` / `console.warn` throughout
- No structured logging framework

**Metrics (inbound from gateway):**
- Gateway servers push metrics batches to `/api/metrics/push` (Bearer token auth)
- Batch includes: reliability events, credential health, skill stats, heartbeats, session updates
- Service: `src/server/services/metrics.service.ts`
- Stored in SQLite tables: `reliability_events`, `credential_health`, `skill_execution_stats`, `gateway_heartbeats`, `sessions`

**Client-side Analytics:**
- Vercel Analytics (injected in layout)

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from `@sveltejs/adapter-vercel`, `@vercel/analytics`)
- Runtime: Node.js 22.x (serverless functions)
- No `vercel.json` present (uses defaults)

**CI Pipeline:**
- No GitHub Actions workflows detected (`.github/workflows/` directory absent)

## Environment Configuration

**Required env vars (production):**
- `TURSO_DB_URL` - libsql:// database URL
- `TURSO_DB_AUTH_TOKEN` - Turso auth token
- `BETTER_AUTH_SECRET` - Random 32+ char string for session signing
- `BETTER_AUTH_URL` - App base URL (e.g., `https://your-app.vercel.app`)
- `VITE_BETTER_AUTH_URL` - Same as above, client-side accessible

**Optional env vars:**
- `B2_KEY_ID`, `B2_APP_KEY`, `B2_ENDPOINT`, `B2_BUCKET_NAME` - File storage
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `ENCRYPTION_KEY` - AES-256-GCM key for server token encryption at rest
- `GITHUB_TOKEN` - GitHub PAT for private marketplace repo access
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_TENANT_NAME` - Database seeding
- `AUTH_DISABLED` - Set to `true` to skip auth (CI/test)

**Secrets location:**
- `.env` file locally (gitignored)
- Vercel environment variables in production

## Webhooks & Callbacks

**Incoming:**
- `POST /api/metrics/push` - Gateway servers push reliability events, heartbeats, skill stats, credential health, session updates (Bearer token auth)
- `POST /api/metrics/credential-health` - Credential health snapshots
- `POST /api/metrics/gateway-heartbeats` - Gateway heartbeat data
- `POST /api/metrics/skill-stats` - Skill execution statistics
- `/api/auth/callback/google` - Google OAuth callback (handled by Better Auth)

**Outgoing:**
- None detected - All external communication is pull-based (WebSocket connect, GitHub API fetch)

---

*Integration audit: 2026-03-05*
