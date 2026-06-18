# Scheduling Module (cal.diy port) — Design

**Status:** Approved 2026-06-17. MVP in progress on `feat/scheduling-module`.
**Module id:** `scheduling` · **Table prefix:** `sched_` · **Repo:** `minion_hub`

## 1. Goal & Context

FACES is hiring onsite team members who attend customer appointments. The org needs:

1. A **native scheduling system** porting the core logic of [cal.diy](https://github.com/calcom/cal.diy) (Cal.com's MIT community fork; Next/Prisma/tRPC) into the hub's SvelteKit/Drizzle stack.
2. **Scheduling links** — shareable pages customers use to self-book.
3. **Resource calendars for the team** — each staff member has an availability schedule and a calendar of appointments.
4. A way to **visualize how human resources are distributed** across the team.
5. **Links to CRM and financial data** so a booking ties back to a customer and a procedure's revenue.

This module mirrors the existing **CRM** and **Finances** hub modules exactly: `org_id text` tenancy via `withOrgCore` (role `app_ledger` + `app.current_org_id` GUC, forced RLS), a companion hand-written RLS migration at the meta-repo root, a per-org `app_modules` toggle, its own nav section, and cross-module bridge services.

### Confirmed decisions
- **Port natively** (not run cal.diy as a service, not embed-only).
- Booking surface: **both** public self-serve `/book/[slug]` **and** internal staff-on-behalf calendar.
- Resources: **team members (staff) only** for v1. `kind` column reserves room/equipment for later without a migration.
- Visualizations: **utilization heatmap + team timeline calendar + revenue/CRM overlay**.

## 2. Data model (`src/server/db/pg-scheduling-schema.ts`)

All tables: `org_id text not null`, `metadata jsonb default '{}'`, queried only through `withOrgCore`.

| Table | Purpose | Key columns |
|---|---|---|
| `sched_resources` | A bookable resource (a staff member) | `kind` text default `'staff'`; `profileId` uuid (hub user, soft ref, nullable); `name`; `timezone` text default `'America/Lima'`; `color`; `active` bool |
| `sched_schedules` | Named availability container | `resourceId` fk; `name`; `timezone`; `isDefault` bool |
| `sched_availability` | Working-hours rows (cal.diy `Availability` port) | `scheduleId` fk; `days int[]` (0=Sun..6=Sat); `startTime`/`endTime` text `'HH:MM'`; `date` date — **null = weekly recurring; set = single-date override** |
| `sched_event_types` | A bookable appointment type | `slug`; `title`; `description`; `length` int (min); `slotInterval` int?; `beforeBuffer`/`afterBuffer` int default 0; `minimumBookingNotice` int default 120; `periodType` text default `'rolling'`; `periodDays` int?; `schedulingType` text? (`round_robin`/`collective`); `requiresConfirmation` bool default false; `public` bool default true; `color`; **`productId` uuid? → `fin_products`** (finance bridge); `active` bool. Unique `(orgId, slug)` |
| `sched_event_type_resources` | M:N — staff who can fulfill an event type | `(eventTypeId, resourceId)` pk |
| `sched_bookings` | An appointment | `uid` text unique; `eventTypeId` fk; `resourceId` fk; `startTime`/`endTime` timestamptz; `status` text (`accepted`/`pending`/`cancelled`/`rejected`/`completed`/`no_show`); `title`; `notes`; `attendeeName`/`attendeeEmail`/`attendeePhone`; **`crmContactId` uuid? → `crm_contacts`** (CRM bridge); `productId` uuid? (snapshot); `source` text (`public_link`/`internal`/`import`); `rescheduledFromId` uuid?; `createdAt`/`updatedAt`. Indexes: `(orgId, startTime)`, `(resourceId, startTime)`, `(orgId, status)`, unique `uid` |
| `sched_links` | A shareable scheduling link | `slug` text unique-per-org; `title`; `eventTypeIds uuid[]`; `resourceId` uuid? (pin to a person); `active` bool; `expiresAt` timestamptz? |

**RLS migration:** `supabase/migrations/<ts>_scheduling.sql` at the meta-repo root — `alter table … enable/force row level security`, `grant` to `app_ledger`, `using (org_id = current_setting('app.current_org_id', true))` policies. Drizzle does **not** manage roles/policies (same as CRM/finance).

## 3. Scheduling engine — `src/server/scheduling/slots.ts` (pure, TDD)

Faithful port of cal.diy's availability→slots computation. Pure functions, no DB/IO, fully unit-tested.

```
computeSlots({ eventType, resources, schedules, availability, existingBookings, range, now, viewerTz }) -> Slot[]
```

1. For each candidate resource, expand its schedule's weekly `sched_availability` across `range` in the **resource's** timezone; a row with a `date` **replaces** that day's weekly hours (override).
2. Subtract busy time: existing bookings (`accepted`/`pending`) padded by `beforeBuffer`/`afterBuffer`; everything before `now + minimumBookingNotice`; everything beyond the rolling `periodDays` window.
3. Slice remaining free intervals into `length`-minute slots stepping by `slotInterval ?? length`.
4. `round_robin` → **union** slots across assigned staff (free if *any* is free; each slot tagged with the resource that would take it). `collective` → **intersect** (all must be free). Single-assignee → that resource only.
5. Convert slot instants to `viewerTz` for display.

`createBooking` (service, transactional): re-derive slots for the requested instant and reject if no longer free (**double-book prevention**); pick the resource (round-robin = least-loaded that day, else first free); resolve `crmContactId` by phone (last-9-digit, Peru) / email against `crm_contact_identities` (reuse the `crm-finance.service` match pattern); snapshot `productId` from the event type; dedupe by `uid`. `requiresConfirmation` event types insert as `pending`; otherwise `accepted`.

Timezone math via the project's existing date lib (verify: `date-fns-tz` / `Temporal` availability during implementation; do not add a new heavy dep without checking).

## 4. Routes & API

**Internal** — under authed `(app)`, every page gated on `isModuleEnabled(ctx,'scheduling')`, writes `requireAdmin`:

- `/scheduling` — dashboard: KPIs + **utilization heatmap** + upcoming appointments
- `/scheduling/calendar` — **team timeline calendar** (columns = staff, day/week)
- `/scheduling/event-types` — manage event types (+ link to `fin_products`)
- `/scheduling/resources` — manage staff resources + availability editor
- `/scheduling/bookings` — appointment list / manage (cancel, mark complete/no-show)
- `/scheduling/links` — create/manage scheduling links
- `/scheduling/settings` — module settings

**Public** — `/book/[slug]` **outside** `(app)`, unauthenticated: resolves org + link/event-type from slug, shows slots, takes a booking. API under `/api/scheduling/*`; public booking endpoints resolve the org from the slug then run under a **system core ctx scoped to that org**, rate-limited.

> **Security note (main consideration):** the public path supplies the org id from the slug *without* a user session. RLS still **forces** `org_id` on every `sched_*` table, so the public path can only ever read/write rows for the resolved org. The slug→org resolution and rate-limiting are the trust boundary; everything downstream is RLS-isolated like the rest of the hub.

## 5. The three visualizations

- **Utilization heatmap** (`/scheduling`): per-staff `booked_minutes / available_minutes` over a date range → % utilization, rendered as a resources×days heatmap. SQL aggregate of `sched_bookings` against expanded availability.
- **Team timeline calendar** (`/scheduling/calendar`): the clinic day-sheet — staff as columns, bookings as time-blocks, day/week toggle.
- **Revenue/CRM overlay**: weights distribution by `booking.productId` price + linked `fin_invoices` revenue and attendee CRM lifecycle (e.g. hours on high-value vs deposit-only clients per staff). Reuses `crm-finance.service` phone-match. Requires both `crm` + `finances` enabled (`bothEnabled`).

## 6. Module plumbing

`moduleId: 'scheduling'` in `app_modules` (Settings → Modules admin toggle). Nav section added to `src/lib/components/layout/sections.ts` + route registry (`$lib/nav/routes`), gated on module-enabled (UX hide; routes also server-guarded). i18n keys EN/ES via Paraglide.

## 7. Testing strategy

TDD on the engine first. Coverage:
- `slots.ts`: weekly expansion, date overrides, before/after buffers, minimum notice, rolling period, timezone + DST boundaries, round-robin union, collective intersect, booking subtraction, slot slicing/interval/offset.
- `createBooking`: double-book rejection (concurrency), pending vs accepted, CRM contact resolution, product snapshot, uid idempotency.
- Bridge: phone/email match correctness; utilization aggregate math.
- Keep the repo green: `bun run check` 0/0, `bun run test` all pass.

---

## 8. MVP scope (build now)

A working vertical slice, end to end:

- **P0** — `pg-scheduling-schema.ts` + companion RLS migration + `scheduling` module toggle + nav section + i18n.
- **P1** — `slots.ts` engine (TDD) + services (resources, schedules, event-types, bookings, slots, utilization).
- **P2** — internal UI: dashboard with utilization heatmap, resources + availability editor, event-types CRUD, bookings list, team timeline calendar.
- **P3** — public `/book/[slug]` self-serve booking flow.
- **Bridges (MVP level)** — booking → `crmContactId` resolution; appointments surfaced on the CRM contact detail; event-type ↔ `fin_products` link; basic revenue figure per staff on the dashboard.

MVP deliberately **single-assignee or simple round-robin**, **auto-accept** bookings (no approval queue unless `requiresConfirmation`), **no external calendar sync**, **no automated reminders**.

## 9. Future roadmap (post-MVP)

| # | Item | Notes |
|---|---|---|
| R1 | **External calendar sync** (Google / Microsoft) | cal.diy `SelectedCalendar` equivalent; pull busy-time into slot computation + push bookings out. Biggest follow-on. |
| R2 | **Automated reminders & confirmations** | Fire via the gateway's channel extensions (WhatsApp/Telegram/email) — reuse `messages` ledger; reminder N hours before, confirmation on booking, cancellation notice. |
| R3 | **Reschedule & cancellation self-serve** | Public links to reschedule/cancel via `uid`; `rescheduledFromId` already modeled. |
| R4 | **Approval queue UI** | Full workflow for `requiresConfirmation` event types (notify admin, accept/reject). |
| R5 | **Rooms & equipment resources** | Flip `kind`; a booking consumes staff **and** a room — multi-resource conflict checking in `slots.ts`. |
| R6 | **Recurring appointments & packages** | Series bookings; tie to finance "package" products (e.g. 6-session treatment plans). |
| R7 | **Payment / deposit on booking** | Collect the 50-soles reserva deposit at booking time via the finance/SUSII path; reconcile booking → `fin_invoices`. |
| R8 | **No-show & conversion analytics** | Did the appointment convert to a paid procedure? Deep revenue/CRM overlay, no-show rates per staff, lead→appointment→procedure funnel (extends the CRM funnel). |
| R9 | **Round-robin fairness & load-balancing** | Weighted assignment, max-bookings-per-day caps, skill/service matching (staff who can do which procedures). |
| R10 | **Waitlists & overbooking policy** | Queue for full slots; auto-promote on cancellation. |
| R11 | **Embeddable widget + API** | `/book` embed snippet for the marketing site (`minion_site`); public booking API for partners. |
| R12 | **Promote `sched_*` to `@minion-stack/db`** | Only if the gateway ever needs scheduling (same criterion CRM/finance use). |
