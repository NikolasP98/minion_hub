# Scheduling — stress-test scenarios (local QA stack)

Target: `http://127.0.0.1:5199` only. Personas and passwords: `.env.qa.local` (`tenancy.user.<role>@qa.minion.test`, `QaStack!2026`). Fixtures: `scripts/qa/seed/matrix.ts` (ids in `sched.*`, `crm.*`, `pos.*`). Every step gets a screenshot; every network error, 500, console error, or layout break is recorded with the request URL. Do not mark PASS without evidence. Record timings for any action over 3 s.

Seeded facts to rely on: resources `RESOURCE_LIMA` (staff, America/Lima, Mon–Fri 09:00–18:00), a Madrid staff resource (Europe/Madrid), a room, an equipment; event types plain / requires-confirmation / round-robin (2 resources) / custom-schedule / linked-to-service / private; kinds default + custom; `sched.booking.series-3` (Mon/Wed/Fri this week on Lima), one booking per status, `sched.booking.fully-linked` (grant + plan + invoice + VIP contact), `sched.booking.rescheduled-from`, `sched.link.expired`; `org.personal` has zero kinds and hides POS/Stock.

## S1 — Calendar navigation and views (owner)
1. `/scheduling/calendar` opens in the work-week view by default; the seeded series shows Mon/Wed/Fri; the VIP dot shows on the fully-linked booking.
2. Switch day → week → month → back; the same bookings appear in each; count them on Wednesday in all three views and they match.
3. Jump forward 4 weeks and back with the arrows, then use "today"; no booking disappears or duplicates.
4. Switch the UI to Spanish (`/es/scheduling/calendar`): weekday names and month names are Spanish; time axis is 24 h; go back to English.
5. Resize to 390 px width: the calendar remains usable (no horizontal page scroll, toolbar wraps, event chips truncate with a title attribute).

## S2 — Create bookings at the edges of availability (owner)
1. New booking on Lima staff at 08:30 Monday (before availability) → refused with a clear message; at 09:00 → accepted; at 17:30 with a 60-minute event type → refused (ends after 18:00) or accepted with warning — record which, and whether the message names the reason.
2. Same on the Madrid resource: pick a time that is 09:00 Madrid; confirm the calendar renders it in the org timezone and the detail card shows the right local time for both.
3. Saturday booking on Lima staff (availability is Mon–Fri) → refused. Book on the date-override day-off (find the seeded override in the schedule settings) → refused.
4. Create a booking that overlaps an existing accepted booking on the same resource → refused; overlapping on a different resource → accepted.
5. Create a booking on the equipment resource and on the room; both appear in the resource filter.

## S3 — Round-robin and collective event types
1. Book the round-robin event type three times in a row at different times; observe which resource each lands on; expect alternation between Lima and Madrid (record the actual pattern).
2. Set one of the two resources inactive in settings; book again; only the active one is assigned; re-activate.
3. Book the requires-confirmation type; booking lands as `pending`; accept it from the detail drawer → `accepted`; book another and reject → `rejected`; both status changes appear in the timeline/log if one is shown.

## S4 — Edit, move, resize, reschedule
1. Drag the Wednesday series occurrence to Thursday; only that occurrence moves; the series id is kept or the occurrence detaches — record which, and that the other two are untouched.
2. Resize a booking by 30 minutes past another booking → refused or clipped; record.
3. Open `sched.booking.rescheduled-from`: the "rescheduled from" link resolves to the original booking.
4. Edit the fully-linked booking's time; save; verify the grant, plan, invoice and contact links survive (open the detail drawer after save).
5. Edit the client note and internal note; the client note appears in the public-facing view (if any) and the internal note does not.

## S5 — Cancel with scope
1. Cancel one occurrence of the series with scope "this only" → the other two remain.
2. Cancel with scope "this and following" on the first remaining → all remaining cancelled; the original single-occurrence cancellation stays cancelled.
3. Cancel the fully-linked booking → its package redemption is reversed (check `/pos/accounts` for the contact: the grant's used count drops by 1) and the invoice/plan links are intact.
4. Try to cancel a `completed` booking → refused or allowed with warning; record.

## S6 — Public booking link
1. Open the seeded public link slug in a fresh incognito context (no login) → availability shown; book a slot as a new client with email + phone → booking created with `source = public_link`, a party/contact created, confirmation page shown.
2. Open `sched.link.expired` → an "expired" page, not a form, not a 500.
3. Attempt to book the private event type via URL manipulation on the public link → refused.
4. Book the last available slot of a day via the public link, then try the same slot again → refused (double-booking guard).

## S7 — Kinds, tags and inherited visuals
1. Change the fully-linked booking's kind to the custom kind → its colour changes; set kind to none → falls back to the event type's kind, then to the org default.
2. Toggle the per-user "inherited artifacts" switch off → the VIP dot disappears; on → returns; reload → preference persists.
3. Add a second tag to the VIP contact (via CRM) → the booking shows two artifacts or a "+1"; record.

## S8 — Team page and HR
1. `/scheduling/team` (or `/team`) shows the seeded employees; the `left` employee is not in the active roster; the week strip is localized.
2. Approve a `pending` leave request → the resource shows unavailable for those days on the calendar; try to book on one of those days → refused.
3. The manual holiday blocks bookings for all resources that day.

## S9 — Role limits (staff, viewer)
1. Staff logs in → module mode; can create and edit their own bookings; can they delete? Record.
2. Viewer opens `/scheduling/calendar` → read-only: no create button, drag disabled, detail drawer has no save. Try a direct `POST /api/scheduling/bookings` with the viewer session (use the page's own fetch in devtools) → 403.

## S10 — Volume and concurrency
1. Create 25 bookings in one day on one resource via the UI as fast as possible (15-minute slots); the day view renders all 25 without overlap glitches; the month view shows a "+N" indicator or all of them; record render time.
2. In two browser contexts as owner and staff, book the same slot simultaneously (click Confirm within 1 s of each other) → exactly one succeeds; the other gets a clear conflict message.

## S11 — Personal org
1. Log in as `tenancy.user.two-orgs`, switch to the personal org: `/scheduling/calendar` works with zero kinds (a default kind is created lazily), POS/Stock are absent from navigation, and `/pos/sell` returns 404/redirect.
