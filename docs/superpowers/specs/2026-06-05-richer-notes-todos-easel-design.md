# Richer Notes & Todos + Easel Board — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — ready for plan
**Scope:** `minion_hub` only — new `notes` table in **Supabase Postgres** (the main DB), images on existing B2
**Inspiration:** Odysseus notes/editor modules, Arc Browser's Easel, PureRef

## Problem

The existing Notes & Todos panel (`src/lib/components/my-agent/NotesPanel.svelte` +
`src/lib/state/features/agent-notes.svelte.ts`) is a Google-Keep-style list backed by
`localStorage`. It holds freeform text and checklists only — no images, no spatial
arrangement, no cross-device sync. The user wants:

1. **Image attachments** on notes/todos (upload, paste, drag-drop).
2. **Images from links** — paste an image URL and have it rendered/kept.
3. A **freeform spatial board** ("Easel") inspired by Arc's Easel and PureRef: images
   and text floating on a pan/zoom canvas, drag-to-move, resize, rotate, z-order.
4. A fullscreen **zen / focus mode** for writing a single note distraction-free.
5. A **WYSIWYG rich-text editor** for note bodies that serializes to **Markdown**.
6. **Tab-to-autofill** AI suggestions while typing (subtle ghost text):
   - *note* → completes the current paragraph; **Tab again accepts**.
   - *todo* → suggests further checklist items from the existing content; **Tab again accepts**.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Form factor | **Both** — enrich existing cards *and* add a new `easel` note kind (fullscreen freeform board) |
| Image storage | **Server-side** — B2 via existing `/api/files`; notes persisted in a new DB table |
| URL images | **Fetch & re-host through the SSRF guard** (not hotlink) |
| DB home | **New `notes` table in Supabase Postgres** (the main DB) — hub-local `pg-schema`, mirrors the `flows`/`messages` migration. **Not** Turso, **not** the `@minion-stack/db` tgz. |
| Rich-text editor | **Tiptap** (ProseMirror) + **`tiptap-markdown`** for Markdown ⇄ doc serialization, via the `svelte-tiptap` Svelte-5 wrapper. Chosen over Milkdown (markdown-native but thinner Svelte-5 support + more opinionated plugin API) and Carta (already installed but split-pane, not true WYSIWYG) because the **Tab ghost-text autocomplete** needs a well-documented custom ProseMirror decoration/keymap extension — Tiptap's ecosystem (7.9k+ doc snippets, maintained `svelte-tiptap`) is the lowest-risk path for that. |
| AI autofill | Server route using the **existing Vercel AI SDK + OpenRouter** (as `/api/structured-stream` already does); fast/cheap model. Ghost text = a Tiptap/ProseMirror decoration; Tab to request, Tab to accept. |
| Sequencing | **Build & ship all phases** |

## Existing infrastructure reused (no new wheels)

- **B2 uploads** — `POST /api/files` (multipart → `uploadFile`), `GET /api/files/[id]/raw`
  (302 → freshly-signed B2 URL). `files` table already exists with a `category` column.
- **SSRF guard** — `src/server/services/ssrf-guard.ts` (blocks loopback/RFC-1918/link-local/
  metadata IPs; already unit-tested). Used by the URL re-host endpoint.
- **Supabase Postgres core DB** — `getCoreDb()` (`src/server/db/pg-client.ts`, Drizzle over
  `postgres-js`, `SUPABASE_DB_URL`). Hub-local Drizzle schemas live in
  `src/server/db/pg-schema/` (e.g. `flows.ts`). `getFlowsCtx` (`src/server/auth/flows-ctx.ts`)
  resolves `{ db: getCoreDb(), tenantId }` — `tenantId` comes from the Turso `organization`
  table (cross-DB ref). The `notes` table follows this exact pattern. **No `@minion-stack/db`
  tgz rebuild** — adding a Supabase table is just a new `pg-schema/notes.ts` + a
  `CREATE TABLE` migration applied to Supabase (local 127.0.0.1:54322 for dev; prod project
  `fsdaqawhzvlphcbxzzji`).
- **Service pattern (Turso side, for reference)** — `src/server/services/file.service.ts`:
  `TenantContext`-scoped, `cached()` + `invalidateTags()`. The notes **service** mirrors this
  shape but takes the Supabase `NotesCtx` and queries `getCoreDb()`.
- **Server-side LLM** — `src/routes/api/structured-stream/+server.ts` already uses the Vercel
  **AI SDK** (`ai`) with **OpenRouter** (`createOpenAI` → `https://openrouter.ai/api/v1`,
  `OPENROUTER_API_KEY`). The autofill route reuses this exact setup with a fast model and
  `generateText`.

## Architecture

### Data model — `notes` table (Supabase Postgres, hub-local `pg-schema`)

Stable scalar shell + an evolving JSON `data` document, so card/easel shapes grow without
migrations. One row per note. **Personal** — owner-scoped (`user_id`) within a tenant
(unlike `flows`, which is org-shared). Timestamps are epoch-ms as `bigint mode:'number'`,
matching `flows.ts`.

```ts
// src/server/db/pg-schema/notes.ts  (hub-local, NOT @minion-stack/db)
import { pgTable, text, boolean, bigint, index } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id'),                 // org scope (cross-DB ref → Turso organization.id)
  userId: text('user_id'),                     // owner — notes are personal (gates visibility)
  kind: text('kind').notNull().default('note'),// 'note' | 'todo' | 'easel'
  title: text('title').notNull().default(''),
  color: text('color').notNull().default('default'),
  pinned: boolean('pinned').notNull().default(false),
  data: text('data').notNull().default('{}'),  // JSON string; shape depends on kind
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('notes_owner_idx').on(t.tenantId, t.userId),
  index('notes_updated_idx').on(t.updatedAt),
]);
```

Migration: `CREATE TABLE IF NOT EXISTS notes (...)` + indexes, applied to Supabase via
`mcp__supabase` `apply_migration` — local stack for dev, prod project `fsdaqawhzvlphcbxzzji`
for release (the same path the `messages` ledger used).

`data` shapes (validated with Zod in the service):

- `note`  → `{ body: string, attachments: Attachment[] }` — `body` is **Markdown** (Tiptap output)
- `todo`  → `{ items: { id, text, done }[], attachments: Attachment[] }`
- `easel` → `{ items: EaselItem[], camera?: { x, y, zoom } }`

```ts
type Attachment = { id: string; fileId: string; w: number; h: number };
type EaselItem =
  | { id: string; type: 'image'; fileId: string; x: number; y: number; w: number; h: number; rotation: number; z: number }
  | { id: string; type: 'text';  text: string;   x: number; y: number; w: number; h: number; rotation: number; z: number; color?: string };
```

Images are **never** stored inline — `fileId` references the `files` table; rendered via
`/api/files/<fileId>/raw`.

### Server — context + service + routes

`src/server/auth/notes-ctx.ts` → `getNotesCtx(locals): Promise<NotesCtx | null>` returning
`{ db: getCoreDb(), tenantId, userId }`. Like `getFlowsCtx` but **also carries `userId`**
(`locals.user.id`) because notes are personal. Returns null if unauthenticated.

`src/server/services/notes.service.ts` takes `NotesCtx`:
`listNotes(ctx)`, `createNote(ctx, input)`, `updateNote(ctx, id, patch)`, `deleteNote(ctx, id)`
— every query filtered by `tenantId` **and** `userId` (ownership). Zod-validate `data` per
kind on write. Queries the `notes` pgTable via `ctx.db`.

Routes (auth via `requireAuth(locals)` + `getNotesCtx`, mirroring the flows routes):

| Route | Method | Action |
|---|---|---|
| `/api/notes` | `GET` | list current user's notes |
| `/api/notes` | `POST` | create `{ kind, title?, color?, data? }` |
| `/api/notes/[id]` | `PUT` | update `{ title?, color?, pinned?, data? }` (ownership-checked) |
| `/api/notes/[id]` | `DELETE` | delete (ownership-checked) |
| `/api/notes/fetch-image` | `POST` | `{ url }` → SSRF-validate → fetch → `uploadFile(category:'notes')` → `{ fileId, w, h }` |
| `/api/notes/autocomplete` | `POST` | `{ kind:'note'\|'todo', context }` → AI SDK `generateText` → note: `{ suggestion }` (paragraph continuation), todo: `{ items: string[] }` |

`fetch-image` guards: SSRF check on the resolved host; reject non-`image/*` content-type;
cap at ~10 MB; follow ≤3 redirects re-checking each hop; timeout ~8s.

`autocomplete` guards: auth required; `context` length-capped (~4 KB); abortable; short
`maxTokens`; fast model (e.g. `anthropic/claude-3.5-haiku` or `openai/gpt-4o-mini` via
OpenRouter — pick lowest-latency available). Prompt is tightly scoped so the model returns
*only* a continuation / new items, no preamble.

### State — `agent-notes.svelte.ts` (server-backed rewrite)

Keep the public store contract (so the panel and any callers stay working), but back it with
the API instead of `localStorage`:

- `loadNotes()` → `GET /api/notes` once; populate `notesState.notes`.
- Mutations update local state **optimistically**, then **debounced autosave** (~600ms) via
  `PUT /api/notes/[id]`; create/delete fire immediately.
- **One-time migration:** on first load, if `localStorage('minion-agent-notes')` exists,
  `POST` each legacy note, then clear the key (guard with a `minion-agent-notes-migrated`
  flag).
- New helpers: `addAttachment(noteId, fileId, w, h)`, `removeAttachment`, `addImageFromUrl`,
  plus easel-item helpers (`addEaselItem`, `moveEaselItem`, `resizeEaselItem`,
  `setEaselItemZ`, `deleteEaselItem`).

### UI

**`NotesPanel.svelte` (enriched sidebar)** — note/todo cards gain an image strip:
- Buttons: upload (file picker), "from URL" (prompt → `fetch-image`). Card also accepts
  **Ctrl+V** paste of an image and **drag-drop** of image files when focused/hovered.
- Thumbnails in a small grid; click → lightbox overlay; hover → remove.
- New **Easel** add-button alongside Note/Todo. An `easel` card renders a mini static preview
  (scaled-down items) + an "Open board" button.

**`NoteEditor.svelte` (new — Tiptap WYSIWYG)** — replaces the plain `<textarea>` for `note`
bodies. Wraps `svelte-tiptap` with `StarterKit` + `tiptap-markdown`; `getMarkdown()` on change
feeds the debounced autosave into `data.body`. Inline images (attachments) can render in-flow.
Hosts the **autofill extension** (below). Used both in the sidebar card and in zen mode.

**`ZenMode.svelte` (new fullscreen overlay)** — distraction-free single-note editor: centered
`NoteEditor` (note) or a focused checklist (todo) on a dimmed full-screen backdrop, generous
measure, title at top, Esc / button to exit. Opened from a card's "Focus" affordance. Same
store + autosave, just a different chrome.

**`tiptap-autofill.ts` (new — ProseMirror extension)** — the Tab ghost-text:
- **Tab** with no active suggestion → debounced `POST /api/notes/autocomplete` with the current
  body/items as `context`; render the result as a dimmed inline **Decoration.widget** (ghost
  text) at the caret — nothing committed yet.
- **Tab again** → accept: insert the suggestion as real text (note) / append as new checklist
  items (todo); clear the decoration.
- **Esc / any other key / selection change** → dismiss the ghost without inserting.
- Todos (plain inputs, not Tiptap) get a sibling handler: Tab → fetch suggested items → show
  them as ghost rows → Tab to append.

**`EaselBoard.svelte` (new fullscreen overlay)** — PureRef/Easel freeform canvas:
- World transform: `translate(camera.x,camera.y) scale(zoom)`. **Pan** = space-drag or
  middle-mouse drag; **zoom** = wheel (cursor-anchored). Items are absolutely-positioned
  elements (no PixiJS), following Odysseus `canvas-events.js` / `clipboard-and-drop.js`
  patterns.
- Add images by drop, Ctrl+V, or "from URL"; add text stickies. Select → drag-move,
  corner resize handles, rotate handle, bring-to-front/back, delete (Del).
- Persists `data.items` (+ `camera`) through the debounced notes autosave.
- Toolbar: add-text, add-image, fit-to-content, zoom %, close.

### Cross-project impact

- **Supabase** — new `notes` table applied via `apply_migration` (local + prod
  `fsdaqawhzvlphcbxzzji`). No repo-package change; the table is defined hub-locally in
  `pg-schema/notes.ts`. (Images keep using the Turso `files` table — unchanged.)
- `minion_hub` only — `pg-schema/notes.ts`, `notes-ctx.ts`, `notes.service.ts`, routes,
  state rewrite, two components, lightbox. **No `@minion-stack/db` / Turso schema change.**

## Error handling

- Upload failure → toast, attachment not added.
- SSRF rejection / non-image / oversize → inline error on the URL input; nothing persisted.
- Autosave failure → retry once, then a non-blocking "Couldn't save" toast; local state kept.
- Concurrency → single owner, **last-write-wins** (no merge).
- Corrupt/legacy `data` JSON → tolerated by Zod `.catch()` defaults (same spirit as the
  current `normalize()`).

## Testing

- `notes.service.test.ts` — CRUD, tenant+user scoping (can't read/update another user's note),
  Zod validation of `data` per kind.
- `fetch-image` endpoint — mock fetch: accepts a valid image, rejects SSRF host, rejects
  non-image content-type, rejects oversize.
- `autocomplete` endpoint — mock the AI SDK: note returns `{ suggestion }`, todo returns
  `{ items }`; rejects unauthenticated; caps oversized `context`.
- State migration — legacy `localStorage` payload → POSTs once, sets migrated flag, clears.
- Autofill extension — accept-on-second-Tab inserts; dismiss-on-Esc leaves body unchanged
  (unit-test the accept/dismiss state machine; the network call is mocked).
- `ssrf-guard` already covered.

## Build phases (each shippable)

1. **Data layer** — `pg-schema/notes.ts` + Supabase `CREATE TABLE` migration (local),
   `notes-ctx.ts`, `notes.service` + tests, `/api/notes/*`, `/api/notes/fetch-image` + SSRF
   test.
2. **Server-backed state** — rewrite `agent-notes.svelte.ts`, localStorage migration; existing
   card panel keeps working unchanged.
3. **Enrich cards** — image attachments (upload/paste/drop/URL) + lightbox in `NotesPanel`.
4. **Rich-text editor + zen mode** — add Tiptap deps, `NoteEditor.svelte` (Markdown body),
   `ZenMode.svelte` fullscreen focus; wire into card + zen.
5. **AI Tab-autofill** — `/api/notes/autocomplete` route, `tiptap-autofill.ts` ghost-text
   extension (note completion), todo ghost-row suggester.
6. **Easel board** — `EaselBoard.svelte` freeform canvas + persistence + launcher card.

Release: apply the `notes` migration to prod Supabase (`fsdaqawhzvlphcbxzzji`), then ship the
hub to Vercel (dev → master).

## Non-goals (YAGNI)

- No multi-user/shared notes or realtime collaboration.
- No drawing/brush tools, filters, or AI editing on the Easel (that lives in `/plugins/studio`).
- No folders/tags beyond the existing color + pin + search.
- Autofill is **one-shot ghost text on demand** (Tab) — not continuous as-you-type inline
  prediction, and not a streaming multi-paragraph generator.
- Markdown body supports the StarterKit set (headings, bold/italic, lists, code, quote, links);
  no tables/embeds/mentions in v1.
