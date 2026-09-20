/**
 * POS — settings, series, shifts, tickets/lines/payments, package
 * grants/redemptions, payment plans, client ledger, shadow emissions.
 */
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS, ORG_IDENTITY_REQUIRED, userId } from './tenancy';
import {
  PRODUCT_SERVICE_PLAIN,
  PRODUCT_BUNDLE_TWO_SERVICES,
  PRODUCT_BUNDLE_CHILD_A,
  PRODUCT_BUNDLE_CHILD_B,
} from './catalog';
import { CONTACT_DNI_VERIFIED } from './crm';
import type { SeedContext } from './db';

export const SHIFT_OPEN = matrixUuid('pos.shift.open');
export const SHIFT_CLOSED_VARIANCE = matrixUuid('pos.shift.closed-variance');
export const SHIFT_IDENTITY_REQUIRED = matrixUuid('pos.shift.open', 'identity-required-org');

export const TICKET_SPLIT_TENDER = matrixUuid('pos.ticket.split-tender-with-change');
export const TICKET_CREDIT = matrixUuid('pos.ticket.credit-tender');
export const TICKET_VOIDED = matrixUuid('pos.ticket.voided');
export const TICKET_PENDING_SCHEDULING = matrixUuid('pos.ticket.service-pending-scheduling');
export const TICKET_BUNDLE_TWO_GRANTS = matrixUuid('pos.ticket.bundle-two-grants');
export const TICKET_IDENTITY_VIOLATION = matrixUuid(
  'pos.ticket.identity-required-violation-candidate',
);

export const GRANT_HALF_USED = matrixUuid('pos.grant.half-used');
export const GRANT_EXHAUSTED = matrixUuid('pos.grant.exhausted');
export const GRANT_EXPIRED = matrixUuid('pos.grant.expired');
export const GRANT_CANCELLED = matrixUuid('pos.grant.cancelled');

export const PLAN_OPEN = matrixUuid('pos.plan.open-2-of-3-paid');
export const PLAN_SETTLED = matrixUuid('pos.plan.settled');
export const PLAN_CANCELLED = matrixUuid('pos.plan.cancelled');

const PARTY_LEDGER_POSITIVE = matrixUuid('pos.ledger.topup', 'party');
const PARTY_LEDGER_ZERO = matrixUuid('pos.ledger.deposit', 'party');
const PARTY_LEDGER_NEGATIVE = matrixUuid('pos.ledger.redemption', 'party');
const GRANT_SOURCE_TICKET = matrixUuid('pos.grant.half-used', 'source-ticket');
const GRANT_SOURCE_LINE = matrixUuid('pos.grant.half-used', 'source-line');

async function ticket(
  ctx: SeedContext,
  opts: {
    matrixId: string;
    id: string;
    orgId: string;
    shiftId: string;
    partyId?: string | null;
    subtotal: string;
    total: string;
    status?: 'submitted' | 'voided';
    voided?: boolean;
  },
) {
  const { sql, register, now } = ctx;
  await sql`
    insert into pos_tickets (id, org_id, human_id, shift_id, party_id, status, subtotal, total, created_by, submitted_at, voided_at, voided_by)
    values (
      ${opts.id}, ${opts.orgId}, ${humanId('TKT', opts.matrixId)}, ${opts.shiftId}, ${opts.partyId ?? null},
      ${opts.status ?? 'submitted'}, ${opts.subtotal}, ${opts.total}, ${userId('tenancy.user.owner')},
      ${now.toISOString()}, ${opts.voided ? now.toISOString() : null}, ${opts.voided ? userId('tenancy.user.owner') : null}
    )
    on conflict (id) do update set status = excluded.status, voided_at = excluded.voided_at
  `;
  register(opts.matrixId, { table: 'pos_tickets', where: { id: opts.id } });
}

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const owner = userId('tenancy.user.owner');
  // Policy variants are exercised by POS hardening tests; reset seeded orgs to
  // the backward-compatible defaults without changing unrelated organizations.
  await sql`
    update pos_settings set workflow = '{"postSaleScheduling":"prompt","appointmentPayment":"any_time"}'::jsonb
    where org_id in (${ORG_BUSINESS}, ${ORG_IDENTITY_REQUIRED})
  `;

  await sql`
    insert into pos_settings (org_id, methods, surcharges, emission)
    values (
      ${ORG_BUSINESS},
      ${sql.json([
        { id: 'cash', label: 'Efectivo', enabled: true, takesTendered: true },
        { id: 'card', label: 'Tarjeta', enabled: true, takesTendered: true },
        {
          id: 'credit',
          label: 'Crédito',
          enabled: true,
          takesTendered: false,
          documentDefault: '03',
        },
        { id: 'yape', label: 'Yape', enabled: true, takesTendered: false },
        { id: 'plin', label: 'Plin', enabled: true, takesTendered: false },
        { id: 'transfer', label: 'Transferencia', enabled: true, takesTendered: false },
      ])},
      ${sql.json({ card: { type: 'percent', amount: 3.5, label: 'Recargo tarjeta' } })},
      ${sql.json({ mode: 'shadow', docTypeDefault: '03' })}
    )
    on conflict (org_id) do update set methods = excluded.methods, surcharges = excluded.surcharges, emission = excluded.emission
  `;
  register('pos.settings.business', { table: 'pos_settings', where: { org_id: ORG_BUSINESS } });

  await sql`
    insert into pos_series (id, org_id, doc_type, serie, next_number, environment, active)
    values
      (${matrixUuid('pos.series.beta-01')}, ${ORG_BUSINESS}, '01', 'B999', 1, 'beta', true),
      (${matrixUuid('pos.series.beta-03')}, ${ORG_BUSINESS}, '03', 'B999', 1, 'beta', true)
    on conflict (org_id, doc_type, serie) do update set environment = excluded.environment
  `;
  register('pos.series.beta-01', {
    table: 'pos_series',
    where: { org_id: ORG_BUSINESS, doc_type: '01' },
  });
  register('pos.series.beta-03', {
    table: 'pos_series',
    where: { org_id: ORG_BUSINESS, doc_type: '03' },
  });

  // A real POS session (another concurrent QA agent) may have since opened
  // its own shift for the same org, closing this fixture's in the process —
  // "pos_shifts_one_open_per_org" then rejects flipping ours back to 'open'.
  // Only force 'open' when no OTHER shift already holds that slot, so the
  // seed stays idempotent under concurrent stack usage instead of erroring.
  await sql`
    insert into pos_shifts (id, org_id, status, opened_by, opening_float, closed_by, closed_at, expected, counted)
    values
      (${SHIFT_OPEN}, ${ORG_BUSINESS}, 'open', ${owner}, ${sql.json({ cash: 200 })}, null, null, null, null),
      (${SHIFT_IDENTITY_REQUIRED}, ${ORG_IDENTITY_REQUIRED}, 'open', ${owner}, ${sql.json({ cash: 200 })}, null, null, null, null)
    on conflict (id) do update set status = case
      when exists (
        select 1 from pos_shifts other
        where other.org_id = excluded.org_id and other.status = 'open' and other.id <> excluded.id
      ) then pos_shifts.status
      else excluded.status
    end
  `;
  register('pos.shift.open', { table: 'pos_shifts', where: { id: SHIFT_OPEN } });

  // closed-variance is its own shift (can't also be "open") so it never collides with SHIFT_OPEN's uniqueness rule.
  await sql`
    insert into pos_shifts (id, org_id, status, opened_by, opening_float, closed_by, closed_at, expected, counted)
    values (
      ${SHIFT_CLOSED_VARIANCE}, ${ORG_BUSINESS}, 'closed', ${owner},
      ${sql.json({ cash: 200 })}, ${owner}, ${now.toISOString()},
      ${sql.json({ cash: 500 })}, ${sql.json({ cash: 480 })}
    )
    on conflict (id) do update set counted = excluded.counted
  `;
  register('pos.shift.closed-variance', {
    table: 'pos_shifts',
    where: { id: SHIFT_CLOSED_VARIANCE },
  });

  // ── Tickets ─────────────────────────────────────────────────────────
  await ticket(ctx, {
    matrixId: 'pos.ticket.split-tender-with-change',
    id: TICKET_SPLIT_TENDER,
    orgId: ORG_BUSINESS,
    shiftId: SHIFT_OPEN,
    subtotal: '100.00',
    total: '100.00',
  });
  await sql`
    insert into pos_ticket_lines (id, org_id, ticket_id, kind, fin_product_id, description, qty, unit_price, total, line_no)
    values (${matrixUuid('pos.ticket.split-tender-with-change', 'line')}, ${ORG_BUSINESS}, ${TICKET_SPLIT_TENDER}, 'product', ${PRODUCT_SERVICE_PLAIN}, 'QA Plain Service', 1, 100.00, 100.00, 0)
    on conflict (id) do nothing
  `;
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values
      (${matrixUuid('pos.ticket.split-tender-with-change', 'pay-card')}, ${ORG_BUSINESS}, ${TICKET_SPLIT_TENDER}, ${SHIFT_OPEN}, 'card', 60.00, 60.00),
      (${matrixUuid('pos.ticket.split-tender-with-change', 'pay-cash')}, ${ORG_BUSINESS}, ${TICKET_SPLIT_TENDER}, ${SHIFT_OPEN}, 'cash', 40.00, 50.00)
    on conflict (id) do nothing
  `;

  await ticket(ctx, {
    matrixId: 'pos.ticket.credit-tender',
    id: TICKET_CREDIT,
    orgId: ORG_BUSINESS,
    shiftId: SHIFT_OPEN,
    partyId: PARTY_LEDGER_NEGATIVE,
    subtotal: '80.00',
    total: '80.00',
  });
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values (${matrixUuid('pos.ticket.credit-tender', 'pay')}, ${ORG_BUSINESS}, ${TICKET_CREDIT}, ${SHIFT_OPEN}, 'credit', 80.00, null)
    on conflict (id) do nothing
  `;

  await ticket(ctx, {
    matrixId: 'pos.ticket.voided',
    id: TICKET_VOIDED,
    orgId: ORG_BUSINESS,
    shiftId: SHIFT_OPEN,
    subtotal: '50.00',
    total: '50.00',
    voided: true,
  });
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values (${matrixUuid('pos.ticket.voided', 'pay')}, ${ORG_BUSINESS}, ${TICKET_VOIDED}, ${SHIFT_OPEN}, 'cash', 50.00, 50.00)
    on conflict (id) do nothing
  `;

  await ticket(ctx, {
    matrixId: 'pos.ticket.service-pending-scheduling',
    id: TICKET_PENDING_SCHEDULING,
    orgId: ORG_BUSINESS,
    shiftId: SHIFT_OPEN,
    subtotal: '80.00',
    total: '80.00',
  });
  await sql`
    insert into pos_ticket_lines (id, org_id, ticket_id, kind, fin_product_id, booking_id, description, qty, unit_price, total, line_no)
    values (${matrixUuid('pos.ticket.service-pending-scheduling', 'line')}, ${ORG_BUSINESS}, ${TICKET_PENDING_SCHEDULING}, 'service', ${PRODUCT_SERVICE_PLAIN}, null, 'QA Plain Service (pending scheduling)', 1, 80.00, 80.00, 0)
    on conflict (id) do nothing
  `;
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values (${matrixUuid('pos.ticket.service-pending-scheduling', 'pay')}, ${ORG_BUSINESS}, ${TICKET_PENDING_SCHEDULING}, ${SHIFT_OPEN}, 'cash', 80.00, 80.00)
    on conflict (id) do nothing
  `;

  await ticket(ctx, {
    matrixId: 'pos.ticket.bundle-two-grants',
    id: TICKET_BUNDLE_TWO_GRANTS,
    orgId: ORG_BUSINESS,
    shiftId: SHIFT_OPEN,
    subtotal: '150.00',
    total: '150.00',
  });
  const bundleLineId = matrixUuid('pos.ticket.bundle-two-grants', 'line');
  await sql`
    insert into pos_ticket_lines (id, org_id, ticket_id, kind, fin_product_id, description, qty, unit_price, total, line_no)
    values (${bundleLineId}, ${ORG_BUSINESS}, ${TICKET_BUNDLE_TWO_GRANTS}, 'product', ${PRODUCT_BUNDLE_TWO_SERVICES}, 'QA Two-Service Bundle', 1, 150.00, 150.00, 0)
    on conflict (id) do nothing
  `;
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values (${matrixUuid('pos.ticket.bundle-two-grants', 'pay')}, ${ORG_BUSINESS}, ${TICKET_BUNDLE_TWO_GRANTS}, ${SHIFT_OPEN}, 'cash', 150.00, 150.00)
    on conflict (id) do nothing
  `;
  const grantA = matrixUuid('pos.ticket.bundle-two-grants', 'grant-a');
  const grantB = matrixUuid('pos.ticket.bundle-two-grants', 'grant-b');
  await sql`
    insert into pos_package_grants (id, org_id, crm_contact_id, source_ticket_id, source_line_id, package_product_id, service_product_id, sessions_total, unit_value, status)
    values
      (${grantA}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${TICKET_BUNDLE_TWO_GRANTS}, ${bundleLineId}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 1, 75.00, 'active'),
      (${grantB}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${TICKET_BUNDLE_TWO_GRANTS}, ${bundleLineId}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_B}, 1, 75.00, 'active')
    on conflict (id) do nothing
  `;

  await ticket(ctx, {
    matrixId: 'pos.ticket.identity-required-violation-candidate',
    id: TICKET_IDENTITY_VIOLATION,
    orgId: ORG_IDENTITY_REQUIRED,
    shiftId: SHIFT_IDENTITY_REQUIRED,
    subtotal: '50.00',
    total: '50.00',
  });
  await sql`
    insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
    values (${matrixUuid('pos.ticket.identity-required-violation-candidate', 'pay')}, ${ORG_IDENTITY_REQUIRED}, ${TICKET_IDENTITY_VIOLATION}, ${SHIFT_IDENTITY_REQUIRED}, 'cash', 50.00, 50.00)
    on conflict (id) do nothing
  `;

  // ── Package grants + redemptions ───────────────────────────────────
  await sql`
    insert into pos_tickets (id, org_id, human_id, shift_id, status, subtotal, total, created_by, submitted_at)
    values (${GRANT_SOURCE_TICKET}, ${ORG_BUSINESS}, ${humanId('TKT', 'pos.grant.source')}, ${SHIFT_OPEN}, 'submitted', '0.00', '0.00', ${owner}, ${now.toISOString()})
    on conflict (id) do nothing
  `;
  await sql`
    insert into pos_ticket_lines (id, org_id, ticket_id, kind, description, qty, unit_price, total, line_no)
    values (${GRANT_SOURCE_LINE}, ${ORG_BUSINESS}, ${GRANT_SOURCE_TICKET}, 'product', 'QA Grant Source Line', 1, 0, 0, 0)
    on conflict (id) do nothing
  `;
  await sql`
    insert into pos_package_grants (id, org_id, crm_contact_id, source_ticket_id, source_line_id, package_product_id, service_product_id, sessions_total, unit_value, status, expires_at, cancelled_at, cancelled_by)
    values
      (${GRANT_HALF_USED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${GRANT_SOURCE_TICKET}, ${GRANT_SOURCE_LINE}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 6, 20.00, 'active', null, null, null),
      (${GRANT_EXHAUSTED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${GRANT_SOURCE_TICKET}, ${GRANT_SOURCE_LINE}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 3, 20.00, 'active', null, null, null),
      (${GRANT_EXPIRED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${GRANT_SOURCE_TICKET}, ${GRANT_SOURCE_LINE}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 4, 20.00, 'active', '2020-01-01', null, null),
      (${GRANT_CANCELLED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${GRANT_SOURCE_TICKET}, ${GRANT_SOURCE_LINE}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 5, 20.00, 'cancelled', null, ${now.toISOString()}, ${owner})
    on conflict (id) do update set status = excluded.status
  `;
  register('pos.grant.half-used', { table: 'pos_package_grants', where: { id: GRANT_HALF_USED } });
  register('pos.grant.exhausted', { table: 'pos_package_grants', where: { id: GRANT_EXHAUSTED } });
  register('pos.grant.expired', { table: 'pos_package_grants', where: { id: GRANT_EXPIRED } });
  register('pos.grant.cancelled', { table: 'pos_package_grants', where: { id: GRANT_CANCELLED } });

  const halfUsedBookings = [
    'sched.booking.accepted',
    'sched.booking.pending',
    'sched.booking.completed',
  ];
  const exhaustedBookings = [
    'sched.booking.rejected',
    'sched.booking.no-show',
    'sched.booking.series-3',
  ];
  const reversedRedemptionId = matrixUuid('pos.redemption.reversed');
  // `do update set reversed_at = null` (not `do nothing`) — these rows must
  // stay LIVE on every re-seed. `do nothing` let a real UI redeem/reverse
  // probe against this fixture (grant-redeem guard testing) permanently
  // flip one to reversed, silently breaking the "half-used = 3 of 6"
  // invariant for every later re-seed on the same stack.
  for (const bookingMatrixId of halfUsedBookings) {
    await sql`
      insert into pos_package_redemptions (id, org_id, grant_id, booking_id, redeemed_by)
      values (${matrixUuid('pos.grant.half-used', bookingMatrixId)}, ${ORG_BUSINESS}, ${GRANT_HALF_USED}, ${matrixUuid(bookingMatrixId)}, ${owner})
      on conflict (id) do update set reversed_at = null, reversed_by = null, reversal_reason = null
    `;
  }
  // sched.booking.fully-linked carries GRANT_HALF_USED as its package_grant_id
  // (spec §4) — it needs a live redemption of its own, drawn from that grant,
  // so cancelling the booking has a redemption to reverse.
  await sql`
    insert into pos_package_redemptions (id, org_id, grant_id, booking_id, redeemed_by)
    values (${matrixUuid('pos.grant.half-used', 'sched.booking.fully-linked')}, ${ORG_BUSINESS}, ${GRANT_HALF_USED}, ${matrixUuid('sched.booking.fully-linked')}, ${owner})
    on conflict (id) do update set reversed_at = null, reversed_by = null, reversal_reason = null
  `;
  for (const bookingMatrixId of exhaustedBookings) {
    await sql`
      insert into pos_package_redemptions (id, org_id, grant_id, booking_id, redeemed_by)
      values (${matrixUuid('pos.grant.exhausted', bookingMatrixId)}, ${ORG_BUSINESS}, ${GRANT_EXHAUSTED}, ${matrixUuid(bookingMatrixId)}, ${owner})
      on conflict (id) do update set reversed_at = null, reversed_by = null, reversal_reason = null
    `;
  }
  await sql`
    insert into pos_package_redemptions (id, org_id, grant_id, booking_id, redeemed_by, reversed_at, reversed_by, reversal_reason)
    values (${reversedRedemptionId}, ${ORG_BUSINESS}, ${GRANT_HALF_USED}, ${matrixUuid('sched.booking.rescheduled-from')}, ${owner}, ${now.toISOString()}, ${owner}, 'QA: client cancelled')
    on conflict (id) do update set reversed_at = excluded.reversed_at
  `;
  register('pos.redemption.reversed', {
    table: 'pos_package_redemptions',
    where: { id: reversedRedemptionId },
  });

  // ── Payment plans ───────────────────────────────────────────────────
  await sql`
    insert into pos_payment_plans (id, org_id, crm_contact_id, title, total_amount, status, product_id, due_schedule, created_by, settled_at, cancelled_at, cancelled_by)
    values
      (${PLAN_OPEN}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, 'QA Plan 2-of-3', 300.00, 'open', ${PRODUCT_SERVICE_PLAIN}, ${sql.json(
        [
          { dueOn: '2026-01-01', amount: 100 },
          { dueOn: '2026-02-01', amount: 100 },
          { dueOn: '2026-03-01', amount: 100 },
        ],
      )}, ${owner}, null, null, null),
      (${PLAN_SETTLED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, 'QA Plan Settled', 200.00, 'settled', ${PRODUCT_SERVICE_PLAIN}, null, ${owner}, ${now.toISOString()}, null, null),
      (${PLAN_CANCELLED}, ${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, 'QA Plan Cancelled', 250.00, 'cancelled', ${PRODUCT_SERVICE_PLAIN}, null, ${owner}, null, ${now.toISOString()}, ${owner})
    on conflict (id) do update set status = excluded.status
  `;
  register('pos.plan.open-2-of-3-paid', { table: 'pos_payment_plans', where: { id: PLAN_OPEN } });
  register('pos.plan.settled', { table: 'pos_payment_plans', where: { id: PLAN_SETTLED } });
  register('pos.plan.cancelled', { table: 'pos_payment_plans', where: { id: PLAN_CANCELLED } });

  for (const salt of ['instalment-1', 'instalment-2']) {
    const instalmentTicket = matrixUuid('pos.plan.open-2-of-3-paid', salt);
    await sql`
      insert into pos_tickets (id, org_id, human_id, shift_id, status, subtotal, total, created_by, submitted_at)
      values (${instalmentTicket}, ${ORG_BUSINESS}, ${humanId('TKT', `pos.plan.open-2-of-3-paid.${salt}`)}, ${SHIFT_OPEN}, 'submitted', '100.00', '100.00', ${owner}, ${now.toISOString()})
      on conflict (id) do nothing
    `;
    await sql`
      insert into pos_ticket_lines (id, org_id, ticket_id, kind, description, qty, unit_price, total, plan_id, line_no)
      values (${matrixUuid('pos.plan.open-2-of-3-paid', `${salt}-line`)}, ${ORG_BUSINESS}, ${instalmentTicket}, 'custom', 'QA Instalment', 1, 100.00, 100.00, ${PLAN_OPEN}, 0)
      on conflict (id) do nothing
    `;
    await sql`
      insert into pos_payments (id, org_id, ticket_id, shift_id, method, amount, tendered)
      values (${matrixUuid('pos.plan.open-2-of-3-paid', `${salt}-pay`)}, ${ORG_BUSINESS}, ${instalmentTicket}, ${SHIFT_OPEN}, 'cash', 100.00, 100.00)
      on conflict (id) do nothing
    `;
  }

  // ── Client ledger — three parties, balances positive/zero/negative ─
  await sql`
    insert into parties (id, org_id, type, name)
    values
      (${PARTY_LEDGER_POSITIVE}, ${ORG_BUSINESS}, 'person', 'QA Ledger Party (positive)'),
      (${PARTY_LEDGER_ZERO}, ${ORG_BUSINESS}, 'person', 'QA Ledger Party (zero)'),
      (${PARTY_LEDGER_NEGATIVE}, ${ORG_BUSINESS}, 'person', 'QA Ledger Party (negative)')
    on conflict (id) do nothing
  `;
  const topupId = matrixUuid('pos.ledger.topup');
  const depositId = matrixUuid('pos.ledger.deposit');
  const redemptionId = matrixUuid('pos.ledger.redemption');
  const refundId = matrixUuid('pos.ledger.refund');
  const adjustmentId = matrixUuid('pos.ledger.adjustment');
  await sql`
    insert into pos_client_ledger (id, org_id, party_id, kind, amount, note, created_by)
    values
      (${topupId}, ${ORG_BUSINESS}, ${PARTY_LEDGER_POSITIVE}, 'topup', 100.00, 'QA topup', ${owner}),
      (${depositId}, ${ORG_BUSINESS}, ${PARTY_LEDGER_ZERO}, 'deposit', 50.00, 'QA deposit', ${owner}),
      (${redemptionId}, ${ORG_BUSINESS}, ${PARTY_LEDGER_ZERO}, 'redemption', -50.00, 'QA redemption (nets to zero)', ${owner}),
      (${refundId}, ${ORG_BUSINESS}, ${PARTY_LEDGER_NEGATIVE}, 'refund', -30.00, 'QA refund', ${owner}),
      (${adjustmentId}, ${ORG_BUSINESS}, ${PARTY_LEDGER_NEGATIVE}, 'adjustment', -10.00, 'QA adjustment', ${owner})
    on conflict (id) do nothing
  `;
  register('pos.ledger.topup', { table: 'pos_client_ledger', where: { id: topupId } });
  register('pos.ledger.deposit', { table: 'pos_client_ledger', where: { id: depositId } });
  register('pos.ledger.redemption', { table: 'pos_client_ledger', where: { id: redemptionId } });
  register('pos.ledger.refund', { table: 'pos_client_ledger', where: { id: refundId } });
  register('pos.ledger.adjustment', { table: 'pos_client_ledger', where: { id: adjustmentId } });

  // ── Shadow emissions ─────────────────────────────────────────────────
  const emissionAccepted = matrixUuid('pos.emission.accepted');
  const emissionRejected = matrixUuid('pos.emission.rejected');
  const emissionError = matrixUuid('pos.emission.error');
  await sql`
    insert into pos_emissions (id, org_id, ticket_id, doc_type, serie, correlativo, environment, status, response_code, response_description)
    values
      (${emissionAccepted}, ${ORG_BUSINESS}, ${TICKET_PENDING_SCHEDULING}, '03', 'B999', 1, 'beta', 'accepted', '0', 'La Factura numero B999-1 ha sido aceptada'),
      (${emissionRejected}, ${ORG_BUSINESS}, ${TICKET_SPLIT_TENDER}, '03', 'B999', 2, 'beta', 'rejected', '2335', 'QA: rejected by SUNAT'),
      (${emissionError}, ${ORG_BUSINESS}, ${TICKET_VOIDED}, '03', 'B999', 3, 'beta', 'error', null, 'QA: connector error')
    on conflict (org_id, doc_type, serie, correlativo) do update set status = excluded.status
  `;
  register('pos.emission.accepted', { table: 'pos_emissions', where: { id: emissionAccepted } });
  register('pos.emission.rejected', { table: 'pos_emissions', where: { id: emissionRejected } });
  register('pos.emission.error', { table: 'pos_emissions', where: { id: emissionError } });
}
