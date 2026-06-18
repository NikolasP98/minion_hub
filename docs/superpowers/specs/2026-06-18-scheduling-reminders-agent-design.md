# Autonomous Reminders Agent (Scheduling R2) — Design

**Status:** Approved 2026-06-18. Building on `feat/scheduling-reminders`.
**Module:** extends `scheduling` · **Tables:** `sched_reminder_config`, `sched_reminders`

## 1. Goal

A self-running agent that watches the schedule and messages FACES customers on WhatsApp — **booking confirmation** on create, then **24h** and **2h** pre-appointment reminders — to cut no-shows. Messages are **LLM-personalized in Spanish** (template fallback). Built in the hub now (reusing the finance bg-sync cron pattern + `gatewayCall('channels.send')` + OpenRouter), with a documented seam to evolve into a gateway-native `archetype:'autonomous'` agent later.

### Confirmed decisions
- Execution: **hub-orchestrated now, gateway-native later**.
- Cadence: **confirmation (on booking) + 24h + 2h before**.
- Channel: **WhatsApp**, **LLM-personalized** (OpenRouter) with deterministic template fallback.
- **Default-off per org** — dormant until an admin enables it and sets the WhatsApp account, so it can never message customers unexpectedly.
- **Opt-out honored** — a CRM contact flagged opted-out is `skipped`.

## 2. Data model (`src/server/db/pg-reminders-schema.ts` + companion RLS migration)

Both tables: `org_id text`, queried only via `withOrgCore`; forced-RLS migration at meta-repo root (mirrors `sched_*`).

**`sched_reminder_config`** (PK `org_id`):
- `enabled boolean default false`
- `stages jsonb default '[{"key":"confirmation"},{"key":"24h","minutesBefore":1440},{"key":"2h","minutesBefore":120}]'`
- `channel text default 'whatsapp'`
- `account_id text` — which gateway WhatsApp account sends (null until configured)
- `personalize boolean default true`
- `locale text default 'es'`
- `from_name text` — brand shown in copy (e.g. "FACES")
- `updated_at timestamptz`

**`sched_reminders`** (one row per booking×stage — audit + dedup):
- `id uuid pk`, `org_id`, `booking_id uuid → sched_bookings(id) on delete cascade`
- `stage text` (`confirmation` | `24h` | `2h`)
- `channel`, `recipient text`, `content text`
- `status text` (`sent` | `failed` | `skipped`)
- `message_id text`, `error text`, `sent_at timestamptz`, `created_at timestamptz`
- **unique `(org_id, booking_id, stage)`** → one send per booking per stage (idempotency; survives retries & reschedules)
- index `(org_id, created_at)` for the activity feed

## 3. Reminder engine — `src/server/scheduling/reminders.ts` (pure, TDD)

```
dueStages({ booking, config, now, sentStageKeys }) -> StageKey[]
```
- `confirmation`: due once when `now ≥ booking.createdAt`, appointment not past (`now < startTime`), `confirmation` not in `sentStageKeys`.
- time-based (`24h`/`2h` from `stages[].minutesBefore`): due when `startTime − minutesBefore ≤ now < startTime`, key not in `sentStageKeys`.
- Recomputed from `booking.startTime` each tick → **reschedules self-correct**, past windows skip. Pure UTC arithmetic, no DB/IO. Booking must be `accepted`/`pending` (cancelled/completed/no_show → no reminders).

## 4. The tick — `/api/scheduling/reminders/tick` (Vercel cron `* * * * *`, `CRON_SECRET`)

Mirrors `finances/sync/tick`. Unauthenticated but `Authorization: Bearer $CRON_SECRET` required.
1. Bypass-read (`getCoreDb`) org ids from `sched_reminder_config where enabled` (∩ scheduling module enabled).
2. Per org via `withOrgCore`: load active bookings with `start_time in [now, now + maxLead + buffer]`; load already-sent stage keys per booking from `sched_reminders`; compute `dueStages`.
3. For each due stage (bounded chunk per tick, e.g. ≤ 25): compose → send → record. Per-item failure `console.error`'d and recorded `failed`, never aborts the batch.

## 5. Compose + send

- **Compose** (`src/server/services/reminder-compose.ts`): Spanish template with `{name, service title, staffName, when}` (formatted in the resource's timezone) + `fromName`. If `config.personalize`, rewrite warmly via OpenRouter (reuse the `crm-insights` `generateText` + `OPENROUTER_API_KEY` pattern); **fall back to the template** on any error/timeout. Per-stage intent (confirmation vs reminder vs final nudge) drives the copy.
- **Send** (`src/server/services/reminders.service.ts`): resolve recipient (`attendeePhone`; skip if absent or opted-out) → `gatewayCall('channels.send', { channel, to, text, idempotencyKey: 'rem-{bookingId}-{stage}' })`. On success: insert into the **`messages` ledger** (`direction:'outbound'`, `channel`, `senderId`=phone, `metadata:{bookingId,stage}`) so reminders show in the CRM contact timeline, and write `sched_reminders` `sent`. On failure: `failed` + error. Missing phone / opted-out: `skipped`.
- **Opt-out**: a CRM contact whose `custom_fields._reminders_opt_out` is truthy (resolved via `crm_contacts` by `crmContactId`) → `skipped`.

## 6. UI — surfaced as an Autonomous Agent (`/scheduling/reminders`)

Agent control center, added to `SchedulingNav`:
- **Enabled** toggle + autonomy summary ("Watches the schedule and sends WhatsApp reminders — on booking, 24h before, and 2h before.").
- Config: stages (lead times), channel, WhatsApp `accountId` (from the gateway channel catalog), `personalize` toggle, `fromName`, `locale`.
- **Status**: last run, counts (sent / failed / skipped) over a window, from `sched_reminders`.
- **Activity feed**: recent reminders (booking, stage, status, time).
- Admin-only writes. +i18n EN/ES.

## 7. Gateway-native seam (R2.1, later — not built now)

`dueStages` + a read-only `/api/scheduling/reminders/pending` endpoint become the contract a future gateway `archetype:'autonomous'` agent calls (via a new hub-bookings gateway tool) to fetch due reminders and send through gateway channels + `cron.add`. Same engine, different driver. The send/compose logic stays reusable.

## 8. Testing

- `dueStages`: each stage window (boundaries), already-sent dedup, past-appointment skip, reschedule self-correct, confirmation-once, inactive-status skip.
- `reminder-compose`: template rendering (vars, tz formatting), LLM fallback path.
- Service: opt-out / no-phone → skipped; idempotency (re-tick doesn't double-send).
- Keep green: `bun run check` 0/0, `bun run test` all pass.

## Build phases
**P0** schema + RLS migration + config service · **P1** `dueStages` engine + compose (TDD) · **P2** tick endpoint + send + ledger logging + `vercel.json` cron · **P3** `/scheduling/reminders` agent UI + nav + i18n.

## Env (all already present)
`CRON_SECRET` (finance cron), `OPENROUTER_API_KEY` (CRM), gateway creds (`MINION_GATEWAY_*` / `OPENCLAW_GATEWAY_*`). Per-org WhatsApp `account_id` stored in config.
