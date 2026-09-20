/**
 * The seed permutation matrix — spec §4. Every row a seed module writes is
 * registered against one of these ids (scripts/qa/seed/index.ts fails if any
 * id here is never registered, and the contract test fails if any registered
 * id doesn't resolve to the state it promises). Add a permutation by adding
 * an entry here + the row (or, for a contrast, the deliberate absence of one)
 * in the owning domain module + (usually) one assertion in
 * `seed.contract.test.ts` — see README.md.
 *
 * A few permutations are "vs default" / "vs missing" CONTRASTS — the point of
 * the fixture is that no row exists (crm_settings absent for the personal
 * org, an org with zero scheduling kinds, a contact with no activity stats).
 * These register with `expect: 'absent'` (see db.ts's `RowRef`) instead of
 * inventing a separate matrix concept — same {table,where}, the contract test
 * just flips the assertion.
 */

export interface MatrixEntry {
  readonly id: string;
  readonly domain:
    | 'tenancy'
    | 'crm'
    | 'catalog'
    | 'pos'
    | 'scheduling'
    | 'stock'
    | 'finances'
    | 'attachments'
    | 'jobs'
    | 'gateway';
  readonly why: string;
}

export const MATRIX_VERSION = 'qa-seed-v1';

export const MATRIX: readonly MatrixEntry[] = [
  // ── Tenancy & identity ────────────────────────────────────────────────
  { id: 'tenancy.org.business', domain: 'tenancy', why: 'FACES-like org, every module on' },
  {
    id: 'tenancy.org.personal',
    domain: 'tenancy',
    why: 'kind=personal; POS/stock/team hidden; zero scheduling kinds (lazy-seed path); zero gateway servers (empty state)',
  },
  {
    id: 'tenancy.org.business.modules-off',
    domain: 'tenancy',
    why: 'app_modules rows disable pos and stock',
  },
  {
    id: 'tenancy.org.business.identity-required',
    domain: 'tenancy',
    why: "pos_settings.requirements.identityDocument='required'",
  },
  { id: 'tenancy.user.owner', domain: 'tenancy', why: 'system role owner' },
  { id: 'tenancy.user.admin', domain: 'tenancy', why: 'system role admin' },
  { id: 'tenancy.user.manager', domain: 'tenancy', why: 'system role manager' },
  { id: 'tenancy.user.staff', domain: 'tenancy', why: 'system role staff' },
  { id: 'tenancy.user.viewer', domain: 'tenancy', why: 'system role viewer' },
  {
    id: 'tenancy.user.custom-role',
    domain: 'tenancy',
    why: 'org_roles key custom-reception sourced from staff, with permission_rules overrides incl. if_owner=true',
  },
  {
    id: 'tenancy.user.legacy-member',
    domain: 'tenancy',
    why: 'only organization_members.role, no member_roles row — the pre-RBAC fallback path',
  },
  { id: 'tenancy.user.platform-admin', domain: 'tenancy', why: "profiles.role='admin'" },
  {
    id: 'tenancy.user.two-orgs',
    domain: 'tenancy',
    why: 'member of both org.business and org.personal',
  },
  { id: 'tenancy.user.service-account', domain: 'tenancy', why: "account_type='service'" },
  {
    id: 'tenancy.user.pending-agent',
    domain: 'tenancy',
    why: "personal_agents.provisioning_status='pending' — lands on onboarding",
  },
  { id: 'tenancy.user.no-org', domain: 'tenancy', why: 'lands on /join' },
  { id: 'tenancy.join.request-pending', domain: 'tenancy', why: 'join_request status=pending' },
  { id: 'tenancy.join.link-expired', domain: 'tenancy', why: 'join_link expires_at in the past' },
  { id: 'tenancy.join.link-revoked', domain: 'tenancy', why: 'join_link revoked=true' },

  // ── CRM ───────────────────────────────────────────────────────────────
  { id: 'crm.contact.dni-verified', domain: 'crm', why: 'party.dni_verified=true, dob populated' },
  { id: 'crm.contact.dni-missing', domain: 'crm', why: 'no party, no doc' },
  { id: 'crm.contact.ruc-company', domain: 'crm', why: "party.type='company', doc_type RUC" },
  { id: 'crm.contact.phone-only', domain: 'crm', why: 'no doc, no email, phone9 only' },
  { id: 'crm.contact.party-null', domain: 'crm', why: 'contact with party_id null' },
  {
    id: 'crm.contact.shared-phone9',
    domain: 'crm',
    why: 'two contacts (own parties) sharing one phone9 — phone9 is a bridge, not an identity',
  },
  {
    id: 'crm.contact.identities-3',
    domain: 'crm',
    why: 'crm_contact_identities rows for whatsapp + instagram + email',
  },
  { id: 'crm.contact.soft-deleted', domain: 'crm', why: 'deleted_at set' },
  { id: 'crm.contact.lifecycle-override', domain: 'crm', why: 'lifecycle_override pins a stage' },
  { id: 'crm.funnel.lead', domain: 'crm', why: "custom_fields._funnel.stage='lead'" },
  { id: 'crm.funnel.opportunity', domain: 'crm', why: "custom_fields._funnel.stage='opportunity'" },
  { id: 'crm.funnel.customer', domain: 'crm', why: "custom_fields._funnel.stage='customer'" },
  { id: 'crm.funnel.loyal', domain: 'crm', why: "custom_fields._funnel.stage='loyal'" },
  {
    id: 'crm.funnel.legacy-id',
    domain: 'crm',
    why: "legacy stage key 'interest' the UI must still render",
  },
  { id: 'crm.rel.user-pinned', domain: 'crm', why: "_relationship.source='user'" },
  { id: 'crm.rel.ai-claimed', domain: 'crm', why: "_relationship.source='ai'" },
  {
    id: 'crm.tag.manual',
    domain: 'crm',
    why: "crm_tags.kind='manual', applied via crm_contact_tags",
  },
  {
    id: 'crm.tag.auto-with-rule',
    domain: 'crm',
    why: "crm_tags.kind='auto' with a rule predicate",
  },
  { id: 'crm.tag.link-booking', domain: 'crm', why: "tag_links entity_kind='booking'" },
  { id: 'crm.tag.link-event-type', domain: 'crm', why: "tag_links entity_kind='event_type'" },
  { id: 'crm.tag.link-product', domain: 'crm', why: "tag_links entity_kind='product'" },
  {
    id: 'crm.tag.event',
    domain: 'crm',
    why: "crm_tags scope='event' — the only scope a booking link may use",
  },
  {
    id: 'crm.tag.catalog',
    domain: 'crm',
    why: "crm_tags scope='catalog' — event types + products",
  },
  {
    id: 'crm.tag.stock',
    domain: 'crm',
    why: "crm_tags scope='stock' — applied to the recipe's child item; the parent recipe + its product inherit it",
  },
  { id: 'crm.tag.link-item', domain: 'crm', why: "tag_links entity_kind='item' (stock item)" },
  {
    id: 'crm.tag.link-orphan',
    domain: 'crm',
    why: 'tag_links row whose entity_id matches nothing',
  },
  {
    id: 'crm.tag.vip',
    domain: 'crm',
    why: "crm_tags 'VIP' (manual), applied to crm.contact.dni-verified — also the tag sched.booking.fully-linked's contact carries, for the calendar's inherited-tag dot",
  },
  {
    id: 'crm.settings.deposit-rule',
    domain: 'crm',
    why: 'custom deposit keywords/label for org.business; org.personal carries no row (defaults)',
  },
  {
    id: 'crm.settings.defaults-personal',
    domain: 'crm',
    why: 'ABSENT: org.personal has no crm_settings row at all (missing row = defaults)',
  },
  {
    id: 'crm.activity.stats-present',
    domain: 'crm',
    why: 'crm_contact_activity_stats row for a busy contact (most contacts intentionally have none)',
  },
  {
    id: 'crm.activity.stats-missing',
    domain: 'crm',
    why: 'ABSENT: crm.contact.dni-missing has no crm_contact_activity_stats row',
  },
  {
    id: 'crm.contact.long-name-emoji',
    domain: 'crm',
    why: 'display_name exactly 120 UTF-16 code units incl. one emoji; party.name matches',
  },

  // ── Catalog ───────────────────────────────────────────────────────────
  {
    id: 'catalog.service.plain',
    domain: 'catalog',
    why: 'plain service, no components, no stk link',
  },
  { id: 'catalog.product.tracked', domain: 'catalog', why: 'uom != unit, backed by a stk_item' },
  {
    id: 'catalog.product.raw-material-link',
    domain: 'catalog',
    why: 'product whose stk_item has a raw-material component edge',
  },
  {
    id: 'catalog.bundle.two-services',
    domain: 'catalog',
    why: 'fin_product_components: two child services',
  },
  {
    id: 'catalog.package.with-validity',
    domain: 'catalog',
    why: 'bundle sellable, metadata.packageValidityDays=90',
  },
  {
    id: 'catalog.package.no-validity',
    domain: 'catalog',
    why: 'bundle sellable, no packageValidityDays',
  },
  {
    id: 'catalog.product.consumption-2-items',
    domain: 'catalog',
    why: 'stk_consumption rows for two stock items',
  },
  { id: 'catalog.sellable.inactive', domain: 'catalog', why: 'active=false' },
  {
    id: 'catalog.product.aliases-and-zone',
    domain: 'catalog',
    why: 'metadata.aliases[] + metadata.zone',
  },

  // ── POS ───────────────────────────────────────────────────────────────
  {
    id: 'pos.settings.business',
    domain: 'pos',
    why: "methods incl. credit + yape/plin/transfer (all takesTendered:false), card surcharge, emission.mode='shadow'",
  },
  { id: 'pos.series.beta-01', domain: 'pos', why: "doc_type='01' beta series" },
  { id: 'pos.series.beta-03', domain: 'pos', why: "doc_type='03' beta series" },
  { id: 'pos.shift.open', domain: 'pos', why: "status='open'" },
  { id: 'pos.shift.closed-variance', domain: 'pos', why: 'counted != expected' },
  {
    id: 'pos.ticket.split-tender-with-change',
    domain: 'pos',
    why: 'two payment methods, tendered > total',
  },
  {
    id: 'pos.ticket.credit-tender',
    domain: 'pos',
    why: "method='credit' — negative client_ledger row",
  },
  { id: 'pos.ticket.voided', domain: 'pos', why: 'voided_at/by set, with reversal rows' },
  {
    id: 'pos.ticket.service-pending-scheduling',
    domain: 'pos',
    why: "service line, booking_id null, non-void — /pos/accounts 'pending scheduling'",
  },
  {
    id: 'pos.ticket.bundle-two-grants',
    domain: 'pos',
    why: 'bundle line grants two package_grants rows',
  },
  {
    id: 'pos.ticket.identity-required-violation-candidate',
    domain: 'pos',
    why: 'party without a doc, in the identity-required org',
  },
  {
    id: 'pos.grant.half-used',
    domain: 'pos',
    why: 'sessions_total=6, 4 live redemptions incl. sched.booking.fully-linked',
  },
  {
    id: 'pos.grant.exhausted',
    domain: 'pos',
    why: 'live redemptions == sessions_total (derived status)',
  },
  { id: 'pos.grant.expired', domain: 'pos', why: 'expires_at in the past (derived status)' },
  { id: 'pos.grant.cancelled', domain: 'pos', why: 'cancelled_at/by set' },
  { id: 'pos.redemption.reversed', domain: 'pos', why: 'reversed_at set, hands the session back' },
  { id: 'pos.plan.open-2-of-3-paid', domain: 'pos', why: '2 of 3 instalment tickets submitted' },
  { id: 'pos.plan.settled', domain: 'pos', why: "status='settled', settled_at set" },
  { id: 'pos.plan.cancelled', domain: 'pos', why: 'cancelled_at/by set' },
  { id: 'pos.ledger.topup', domain: 'pos', why: 'positive amount, kind=topup' },
  { id: 'pos.ledger.deposit', domain: 'pos', why: 'positive amount, kind=deposit' },
  { id: 'pos.ledger.redemption', domain: 'pos', why: 'negative amount, kind=redemption' },
  { id: 'pos.ledger.refund', domain: 'pos', why: 'negative amount, kind=refund' },
  { id: 'pos.ledger.adjustment', domain: 'pos', why: 'signed amount, kind=adjustment' },
  { id: 'pos.emission.accepted', domain: 'pos', why: "status='accepted'" },
  { id: 'pos.emission.rejected', domain: 'pos', why: "status='rejected'" },
  { id: 'pos.emission.error', domain: 'pos', why: "status='error'" },

  // ── Scheduling ────────────────────────────────────────────────────────
  { id: 'sched.resource.staff-lima', domain: 'scheduling', why: 'America/Lima staff resource' },
  {
    id: 'sched.resource.staff-madrid',
    domain: 'scheduling',
    why: 'Europe/Madrid staff resource — DST edge',
  },
  { id: 'sched.resource.room', domain: 'scheduling', why: "kind='room'" },
  { id: 'sched.resource.equipment', domain: 'scheduling', why: "kind='equipment'" },
  {
    id: 'sched.schedule.default-with-override',
    domain: 'scheduling',
    why: 'default weekly schedule + one date-override day-off',
  },
  {
    id: 'sched.resource.madrid-schedule',
    domain: 'scheduling',
    why: 'Mon-Fri 09:00-18:00 Europe/Madrid schedule for staff-madrid, so round-robin can alternate',
  },
  {
    id: 'sched.event-type.plain',
    domain: 'scheduling',
    why: 'no confirmation, single scheduling type',
  },
  {
    id: 'sched.event-type.requires-confirmation',
    domain: 'scheduling',
    why: 'requires_confirmation=true',
  },
  {
    id: 'sched.event-type.round-robin-two-resources',
    domain: 'scheduling',
    why: "scheduling_type='round_robin', two sched_event_type_resources rows",
  },
  {
    id: 'sched.event-type.custom-schedule',
    domain: 'scheduling',
    why: 'use_custom_schedule=true, own schedule_rules',
  },
  {
    id: 'sched.event-type.linked-to-service',
    domain: 'scheduling',
    why: 'product_id -> catalog.service.plain',
  },
  { id: 'sched.event-type.private', domain: 'scheduling', why: 'public=false' },
  {
    id: 'sched.event-type.room',
    domain: 'scheduling',
    why: 'sched_event_type_resources links it to sched.resource.room, so the room is bookable',
  },
  {
    id: 'sched.event-type.equipment',
    domain: 'scheduling',
    why: 'sched_event_type_resources links it to sched.resource.equipment, so the equipment is bookable',
  },
  { id: 'sched.kind.default', domain: 'scheduling', why: 'is_default=true' },
  { id: 'sched.kind.custom', domain: 'scheduling', why: 'org-defined non-default kind' },
  {
    id: 'sched.kind.none-personal',
    domain: 'scheduling',
    why: 'ABSENT: org.personal has zero sched_event_kinds rows (listEventKinds lazy-seed path)',
  },
  { id: 'sched.booking.accepted', domain: 'scheduling', why: "status='accepted'" },
  { id: 'sched.booking.pending', domain: 'scheduling', why: "status='pending'" },
  { id: 'sched.booking.cancelled', domain: 'scheduling', why: "status='cancelled'" },
  { id: 'sched.booking.rejected', domain: 'scheduling', why: "status='rejected'" },
  { id: 'sched.booking.completed', domain: 'scheduling', why: "status='completed'" },
  { id: 'sched.booking.no-show', domain: 'scheduling', why: "status='no_show'" },
  {
    id: 'sched.booking.series-3',
    domain: 'scheduling',
    why: 'three bookings sharing series_id, index 0-2',
  },
  {
    id: 'sched.booking.fully-linked',
    domain: 'scheduling',
    why: 'package_grant_id + payment_plan_id + invoice_id + crm_contact_id all set, with a live (reversed_at null) redemption of its own on that grant',
  },
  { id: 'sched.booking.rescheduled-from', domain: 'scheduling', why: 'rescheduled_from_id set' },
  {
    id: 'sched.booking.kind-null',
    domain: 'scheduling',
    why: 'kind_id null — resolves via event type/org default',
  },
  { id: 'sched.booking.public-link-source', domain: 'scheduling', why: "source='public_link'" },
  { id: 'sched.link.expired', domain: 'scheduling', why: 'expires_at in the past' },
  { id: 'hr.employee.active', domain: 'scheduling', why: "status='active', linked resource" },
  { id: 'hr.employee.left', domain: 'scheduling', why: "status='left', left_on set" },
  { id: 'hr.leave.pending', domain: 'scheduling', why: "hr_leave_requests status='pending'" },
  { id: 'hr.leave.approved', domain: 'scheduling', why: "hr_leave_requests status='approved'" },
  { id: 'hr.leave.rejected', domain: 'scheduling', why: "hr_leave_requests status='rejected'" },
  { id: 'hr.leave.cancelled', domain: 'scheduling', why: "hr_leave_requests status='cancelled'" },
  { id: 'hr.holiday.manual', domain: 'scheduling', why: "hr_holidays source='manual'" },

  // ── Stock ─────────────────────────────────────────────────────────────
  { id: 'stock.warehouse.default', domain: 'stock', why: 'is_default=true' },
  { id: 'stock.warehouse.child', domain: 'stock', why: 'parent_id -> stock.warehouse.default' },
  { id: 'stock.warehouse.archived', domain: 'stock', why: 'archived_at set' },
  { id: 'stock.item.uom-conversion', domain: 'stock', why: 'box -> unit, units_per_stock_uom set' },
  {
    id: 'stock.item.recipe-with-optional-child',
    domain: 'stock',
    why: 'stk_item_components row with optional=true',
  },
  { id: 'stock.item.low-stock', domain: 'stock', why: 'bin qty below reorder_level' },
  {
    id: 'stock.entry.receipt',
    domain: 'stock',
    why: 'first link in the receipt->issue->transfer->adjustment chain',
  },
  { id: 'stock.entry.issue', domain: 'stock', why: 'metadata.invoiceId set' },
  {
    id: 'stock.entry.issue-duplicate-invoice-id',
    domain: 'stock',
    why: 'case/space variant of the same invoiceId — the normalizing unique index must REJECT this insert',
  },
  { id: 'stock.entry.transfer', domain: 'stock', why: 'from_warehouse_id -> to_warehouse_id' },
  { id: 'stock.entry.adjustment', domain: 'stock', why: 'positive rate-bearing adjustment line' },
  { id: 'stock.entry.cancelled', domain: 'stock', why: "status='cancelled'" },
  { id: 'stock.bin.zero', domain: 'stock', why: 'qty=0 after the chain nets out' },
  { id: 'stock.accrual.open', domain: 'stock', why: "status='open'" },
  {
    id: 'stock.accrual.realized',
    domain: 'stock',
    why: "status='realized', realized_entry_id set",
  },
  { id: 'stock.accrual.released', domain: 'stock', why: "status='released'" },
  {
    id: 'stock.consumption.two-items',
    domain: 'stock',
    why: 'stk_consumption for catalog.product.consumption-2-items',
  },

  // ── Finances ──────────────────────────────────────────────────────────
  { id: 'fin.invoice.susii-paid', domain: 'finances', why: "provider='susii', status='paid'" },
  { id: 'fin.invoice.partial', domain: 'finances', why: "status='partial'" },
  { id: 'fin.invoice.pending', domain: 'finances', why: "status='pending'" },
  { id: 'fin.invoice.void', domain: 'finances', why: "status='void'" },
  {
    id: 'fin.invoice.sunat-sire-shadow',
    domain: 'finances',
    why: "provider='sunat-sire' twin of the susii-paid row, shadowed=true",
  },
  {
    id: 'fin.invoice.linked-from-booking',
    domain: 'finances',
    why: 'sched.booking.fully-linked.invoice_id target',
  },
  { id: 'fin.settings.fx-manual', domain: 'finances', why: "fx_mode='manual', fx_manual_rate set" },
  { id: 'fin.statement.queued', domain: 'finances', why: "personal org, status='queued'" },
  { id: 'fin.statement.parsing', domain: 'finances', why: "status='parsing'" },
  {
    id: 'fin.statement.done',
    domain: 'finances',
    why: "status='done', with transactions incl. a rejected row",
  },
  {
    id: 'fin.statement.failed',
    domain: 'finances',
    why: "status='failed', error_code/message set",
  },
  { id: 'fin.statement.undone', domain: 'finances', why: "status='undone'" },
  { id: 'fin.sync.stuck-running', domain: 'finances', why: "status='running', stale heartbeat_at" },
  {
    id: 'fin.purchase.closed-period',
    domain: 'finances',
    why: "fin_purchase_periods status='closed'",
  },
  { id: 'fin.purchase.diverged', domain: 'finances', why: "fin_purchases sync_state='diverged'" },

  // ── Attachments ───────────────────────────────────────────────────────
  {
    id: 'att.file.linked-3-objects',
    domain: 'attachments',
    why: 'attachment_links to a crm_contact, a booking and an invoice',
  },
  { id: 'att.link.trashed', domain: 'attachments', why: 'row exists only in attachment_trash' },
  {
    id: 'att.file.deleting-tombstone',
    domain: 'attachments',
    why: "attachment_file_state.state='deleting'",
  },
  { id: 'att.file.near-quota', domain: 'attachments', why: 'size_bytes just under orgQuotaBytes' },
  {
    id: 'att.link.orphan-object',
    domain: 'attachments',
    why: 'object_id matches no row in its object_type table',
  },

  // ── Jobs / brains ─────────────────────────────────────────────────────
  { id: 'jobs.bg.done', domain: 'jobs', why: "bg_jobs status='done'" },
  { id: 'jobs.bg.failed', domain: 'jobs', why: "bg_jobs status='failed'" },
  { id: 'jobs.bg.cancelled', domain: 'jobs', why: "bg_jobs status='cancelled'" },
  { id: 'jobs.fin-sync.succeeded', domain: 'jobs', why: "fin_sync_jobs status='succeeded'" },
  { id: 'brains.master', domain: 'jobs', why: "kind='master', include_all_sources=true" },
  { id: 'brains.focused', domain: 'jobs', why: "kind='focused'" },
  { id: 'brains.document.failed', domain: 'jobs', why: "brain_documents status='failed'" },
  { id: 'brains.source.degraded', domain: 'jobs', why: "knowledge_sources status='degraded'" },
  {
    id: 'brains.chunk.null-embedding',
    domain: 'jobs',
    why: 'knowledge_chunks row with embedding=null',
  },

  // ── Gateway (libsql) ──────────────────────────────────────────────────
  {
    id: 'gateway.server.business',
    domain: 'gateway',
    why: "org.business gets one server, auth_mode='none', never connected",
  },
  { id: 'gateway.agent.copilot', domain: 'gateway', why: 'archetype copilot' },
  { id: 'gateway.agent.brain', domain: 'gateway', why: 'archetype brain' },
  { id: 'gateway.agent.autonomous', domain: 'gateway', why: 'archetype autonomous' },
  {
    id: 'gateway.session.with-tasks',
    domain: 'gateway',
    why: 'one session_tasks board + ten chat_messages',
  },
  {
    id: 'gateway.session.without-tasks',
    domain: 'gateway',
    why: 'session with zero session_tasks rows',
  },
] as const;

export function matrixById(): ReadonlyMap<string, MatrixEntry> {
  return new Map(MATRIX.map((entry) => [entry.id, entry]));
}
