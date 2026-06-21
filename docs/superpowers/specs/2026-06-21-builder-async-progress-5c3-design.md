# 5c.3 — Artifact builder: async + progress (design)

## Problem
Builder generate/regenerate run the self-repair loop (5c.1) of up to 3 LLM
round-trips synchronously in the request handler. Two pain points:
1. **Timeout risk** — a 3-attempt build can exceed the serverless function
   default `maxDuration`; the request dies with an opaque 504.
2. **No progress** — the modal shows a static spinner for up to a minute; the
   admin can't tell if it's working, stuck, or on attempt 2.

## Decision
Stream **NDJSON** from the *same two endpoints* (matches the house pattern in
`/api/structured-stream`). One progress line per build phase; a terminal line
carries the result or error.

Explicitly **not** building a job table + polling + cron. That infra is
justified for fan-out background work (reminders agent); for an admin-only,
infrequent, single build it's pure over-engineering. Streaming keeps the
client alive and visible without any new persistence.

`maxDuration` is the real timeout knob — set it on both routes (Vercel Pro
allows 300s; Hobby hard-caps 60s). Streaming does NOT raise that ceiling, it
only stops idle-proxy and client-side timeouts and shows progress.

## Shape
- `BuildProgress = { phase: 'generating' | 'repairing'; attempt: number; max: number }`
- `runBuildLoop(apiKey, basePrompt, onProgress?)` — emits `generating` before
  each attempt, `repairing` when a validation fails and it retries.
- `generateArtifactHtml` / `regenerateArtifactHtml` gain an optional
  `onProgress` last arg, passed straight through.
- Endpoints return `application/x-ndjson`. Auth + body validation stay as real
  HTTP errors *before* the stream opens. Generation + DB write happen inside
  the stream; final line is `{ done: true, artifact }` or `{ done: true, error }`.
- Modals read the stream line-by-line, show "Attempt N/3 — generating/repairing…",
  and act on the terminal line.

## Out of scope
Token-level streaming, cancellation, persisted job history. Add only if an
admin actually asks to watch tokens or cancel mid-build.
