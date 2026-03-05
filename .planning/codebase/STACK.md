# Technology Stack

**Analysis Date:** 2026-03-05

## Languages

**Primary:**
- TypeScript ^5.0 - All frontend and backend code (`src/`)
- JavaScript - Config files only (`svelte.config.js`)

**Secondary:**
- CSS (Tailwind v4) - Styling via `@tailwindcss/vite` plugin
- SQL (SQLite dialect) - Via Drizzle ORM raw `sql` template literals

## Runtime

**Environment:**
- Node.js 22.x (specified in `svelte.config.js` adapter config: `runtime: 'nodejs22.x'`)
- Bun - Used as the development runtime and script executor (`bun run dev`, `bun run src/server/seed.ts`)

**Package Manager:**
- Bun
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**
- SvelteKit ^2.52 (`@sveltejs/kit`) - Full-stack framework, SSR + API routes
- Svelte ^5.0 - Component framework, uses Svelte 5 `$state` runes for reactivity
- Tailwind CSS ^4.2 - Utility-first CSS via `@tailwindcss/vite` Vite plugin

**UI Components:**
- Zag.js ^1.34-1.35 (`@zag-js/svelte` + individual machines) - Headless UI primitives: combobox, file-upload, popover, radio-group, select, slider, splitter, switch, toggle-group, tooltip, tree-view
- Lucide Svelte ^0.575 - Icon library
- XY Flow Svelte ^1.5.1 (`@xyflow/svelte`) - Node-based flow/graph editor
- Runed ^0.37 - Svelte 5 utility runes

**Testing:**
- Vitest ^4.0.18 - Test runner
- Config: `vitest.config.ts`

**Build/Dev:**
- Vite 5 - Build tool and dev server
- `@sveltejs/vite-plugin-svelte` ^4.0 - Svelte Vite integration
- `@sveltejs/adapter-vercel` ^5.0 - Vercel deployment adapter
- `drizzle-kit` ^0.31 - Schema push, migration generation, Studio UI
- `svelte-check` ^4.0 - Type checking for Svelte files

## Key Dependencies

**Critical:**
- `drizzle-orm` ^0.45 - SQL ORM for all database operations; used in every service file
- `@libsql/client` ^0.17 - libSQL/Turso client for SQLite (local file or remote Turso)
- `better-auth` 1.4.19 (pinned) - Authentication framework with email/password, Google OAuth, JWT, organizations
- `pixi.js` ^8.16 - 2D WebGL rendering for the Workshop canvas
- `@dimforge/rapier2d-compat` ^0.19 - 2D physics engine (WASM) for Workshop agent interactions

**Infrastructure:**
- `@aws-sdk/client-s3` ^3.992 + `@aws-sdk/s3-request-presigner` ^3.992 - S3-compatible file storage (Backblaze B2)
- `@node-rs/argon2` ^2.0.2 - Password hashing (native Rust binding)
- `@paralleldrive/cuid2` ^3.3 - Collision-resistant unique ID generation
- `echarts` ^6.0 - Charting library for sparklines and activity visualizations
- `carta-md` ^4.11 - Markdown editor component
- `dompurify` ^3.3 - HTML sanitization for rendered markdown

**Internationalization:**
- `@inlang/paraglide-sveltekit` ^0.16 - Compile-time i18n; languages: English (source), Spanish
- Vite plugin in `vite.config.ts`, message files at `project.inlang/messages/{languageTag}.json`

**Analytics:**
- `@vercel/analytics` ^1.6 - Client-side analytics (injected in `src/routes/+layout.ts`)

## Configuration

**Environment:**
- `.env` file (gitignored) with `.env.example` as template
- Required for production: `TURSO_DB_URL`, `TURSO_DB_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- Optional: `B2_*` vars (file uploads), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (OAuth), `ENCRYPTION_KEY` (AES-256-GCM for server tokens), `GITHUB_TOKEN` (marketplace sync)
- `VITE_BETTER_AUTH_URL` - Client-side env var (Vite prefix)
- `AUTH_DISABLED=true` - Bypass all auth checks (CI/test)
- Local dev default: `TURSO_DB_URL=file:./data/minion_hub.db` (SQLite file, no Turso account needed)

**TypeScript:**
- `tsconfig.json` - Extends `.svelte-kit/tsconfig.json`, strict mode, bundler module resolution

**Build:**
- `vite.config.ts` - Paraglide i18n plugin, Tailwind CSS plugin, SvelteKit plugin; optimizeDeps includes Zag.js machines, excludes Rapier2D WASM
- `svelte.config.js` - Vercel adapter (Node 22.x runtime), `$server` path alias to `src/server/`
- `drizzle.config.ts` - Turso dialect, schema at `./src/server/db/schema/**/*.ts`, migrations output to `./drizzle/`

**Path Aliases:**
- `$lib` -> `src/lib/` (SvelteKit default)
- `$server` -> `src/server/` (defined in `svelte.config.js`)
- `$env/dynamic/private` - SvelteKit virtual module for server-side env vars

## Platform Requirements

**Development:**
- Bun runtime installed
- Copy `.env.example` to `.env`
- Run `bun run db:push` then `bun run db:seed` to initialize local SQLite database
- No external services required for basic dev (SQLite file, no Turso/B2)

**Production:**
- Vercel (via `@sveltejs/adapter-vercel` with Node.js 22.x runtime)
- Turso database (libSQL remote) for persistent storage
- Optional: Backblaze B2 for file uploads, Google Cloud Console for OAuth

---

*Stack analysis: 2026-03-05*
