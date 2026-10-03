import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import type { PosPackageGrant } from '$server/db/pg-pos-schema';
import type { GrantView } from '../../pos-packages.service';
import { grantStatus, sessionsRemaining as remainingSessions } from '../../pos-accounts.logic';
import { PosError } from '../errors';
import { lockPosIdentityShared, lockPosSettingsShared } from '../lock-key';
import { requirePosCurrency, storedMoneyMinor, storedMinorNumber } from '../money';
import { checkedLedger, checkedPlan } from '../read-money';
import {
  arrayValue,
  dateValue,
  nullableDate,
  nullableString,
  objectValue,
  parseBalanceBuckets,
  stringValue,
} from './decoders';
import { parseClientKey } from './identity-key';
import { planDetail } from './plan-detail';
import type { ClientAccountDetail, WalletIdentityStatus } from './types';

/** One post-lock statement owns identity, balances and all bounded collections. */
export async function getClientAccountDetail(
  ctx: CoreCtx,
  requestedClientKey: string,
): Promise<ClientAccountDetail | null> {
  const requested = parseClientKey(requestedClientKey);
  return withOrgCore(ctx, async (tx) => {
    await lockPosSettingsShared(tx, ctx.tenantId);
    await lockPosIdentityShared(tx, ctx.tenantId);
    const rows = (await tx.execute(sql`
      with input as (
        select
          ${requested.partyId ?? null}::uuid as requested_party_id,
          ${requested.crmContactId ?? null}::uuid as requested_contact_id
      ), policy as (
        select
          coalesce((select currency from public.pos_settings where org_id = ${ctx.tenantId}), 'PEN') as pos_currency,
          coalesce((select timezone from public.fin_settings where org_id = ${ctx.tenantId}), 'America/Lima') as timezone
      ), facts as (
        select i.*,
          rp.id as requested_party_found,
          rp.name as requested_party_name,
          rc.id as requested_contact_found,
          rc.party_id as requested_contact_party_id,
          rc.display_name as requested_contact_name,
          rc.deleted_at as requested_contact_deleted_at,
          lp.id as linked_party_found,
          lp.name as linked_party_name,
          exists (
            select 1 from public.pos_client_ledger l where l.org_id = ${ctx.tenantId}
              and ((i.requested_party_id is not null and l.party_id = i.requested_party_id)
                or (i.requested_contact_id is not null and l.party_id is null
                  and l.crm_contact_id = i.requested_contact_id))
            union all
            select 1 from public.pos_payment_plans p where p.org_id = ${ctx.tenantId}
              and ((i.requested_party_id is not null and p.party_id = i.requested_party_id)
                or (i.requested_contact_id is not null and p.party_id is null
                  and p.crm_contact_id = i.requested_contact_id))
            union all
            select 1 from public.pos_package_grants g where g.org_id = ${ctx.tenantId}
              and ((i.requested_party_id is not null and g.party_id = i.requested_party_id)
                or (i.requested_contact_id is not null and g.party_id is null
                  and g.crm_contact_id = i.requested_contact_id))
            union all
            select 1 from public.pos_tickets t where t.org_id = ${ctx.tenantId}
              and ((i.requested_party_id is not null and t.party_id = i.requested_party_id)
                or (i.requested_contact_id is not null and t.party_id is null
                  and t.crm_contact_id = i.requested_contact_id))
          ) as owned_evidence
        from input i
        left join public.parties rp on rp.org_id = ${ctx.tenantId}
          and rp.id = i.requested_party_id
        left join public.crm_contacts rc on rc.org_id = ${ctx.tenantId}
          and rc.id = i.requested_contact_id
        left join public.parties lp on lp.org_id = ${ctx.tenantId}
          and lp.id = rc.party_id
      ), identity as (
        select
          case
            when requested_party_id is not null then 'party'
            when requested_contact_deleted_at is null and requested_contact_party_id is not null
              then 'party'
            else 'contact'
          end as canonical_kind,
          case
            when requested_party_id is not null then requested_party_id
            when requested_contact_deleted_at is null and requested_contact_party_id is not null
              then requested_contact_party_id
            else requested_contact_id
          end as canonical_id,
          case
            when requested_party_id is not null then requested_party_id
            when requested_contact_deleted_at is null and requested_contact_party_id is not null
              then requested_contact_party_id
            else null
          end as party_id,
          case when requested_contact_id is not null then requested_contact_id else null end as contact_id,
          case
            when requested_party_id is not null and requested_party_found is not null then 'active'
            when requested_party_id is not null and owned_evidence then 'missing_party'
            when requested_contact_found is not null and requested_contact_deleted_at is not null
              and owned_evidence then 'deleted_contact'
            when requested_contact_found is null and owned_evidence then 'missing_contact'
            when requested_contact_found is not null and requested_contact_deleted_at is null
              and requested_contact_party_id is not null and linked_party_found is null then 'missing_party'
            when requested_contact_found is not null and requested_contact_deleted_at is null then 'active'
            else null
          end as identity_status,
          case
            when requested_party_id is not null and requested_party_found is not null
              then requested_party_name
            when requested_contact_found is not null and requested_contact_deleted_at is null
              then coalesce(requested_contact_name, linked_party_name)
            else null
          end as display_name,
          case
            when requested_party_id is not null then requested_party_found is not null or owned_evidence
            else (requested_contact_found is not null and requested_contact_deleted_at is null)
              or owned_evidence
          end as present
        from facts
      ), owned_contacts as (
        select c.id from public.crm_contacts c cross join identity i
        where i.canonical_kind = 'party' and c.org_id = ${ctx.tenantId}
          and c.party_id = i.canonical_id and c.deleted_at is null
      ), ledger_all as (
        select l.* from public.pos_client_ledger l cross join identity i
        where i.present and l.org_id = ${ctx.tenantId} and (
          (i.canonical_kind = 'party' and
            (l.party_id = i.canonical_id or (l.party_id is null and l.crm_contact_id in
              (select id from owned_contacts))))
          or (i.canonical_kind = 'contact' and l.party_id is null
            and l.crm_contact_id = i.canonical_id)
        )
      ), balances as (
        select currency, sum(amount) as balance from ledger_all group by currency
      ), ledger_page as (
        select * from ledger_all order by created_at desc, id desc limit 201
      ), plan_all as (
        select p.* from public.pos_payment_plans p cross join identity i
        where i.present and p.org_id = ${ctx.tenantId} and (
          (i.canonical_kind = 'party' and
            (p.party_id = i.canonical_id or (p.party_id is null and p.crm_contact_id in
              (select id from owned_contacts))))
          or (i.canonical_kind = 'contact' and p.party_id is null
            and p.crm_contact_id = i.canonical_id)
        )
      ), plan_page as (
        select * from plan_all order by created_at desc, id desc limit 101
      ), paid_by_plan as (
        select tl.plan_id, coalesce(sum(tl.total), 0) as paid_total,
          coalesce(jsonb_agg(distinct t.currency) filter (where t.currency is not null), '[]'::jsonb)
            as ticket_currencies
        from public.pos_ticket_lines tl
        join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
        join plan_page p on p.id = tl.plan_id
        where tl.org_id = ${ctx.tenantId} and t.status not in ('void', 'voided')
        group by tl.plan_id
      ), grant_all as (
        select g.* from public.pos_package_grants g cross join identity i
        where i.present and g.org_id = ${ctx.tenantId} and (
          (i.canonical_kind = 'party' and
            (g.party_id = i.canonical_id or (g.party_id is null and g.crm_contact_id in
              (select id from owned_contacts))))
          or (i.canonical_kind = 'contact' and g.party_id is null
            and g.crm_contact_id = i.canonical_id)
        )
      ), grant_page as (
        select * from grant_all order by created_at desc, id desc limit 101
      ), grant_enriched as (
        select g.*, t.currency as source_currency, fp.name as package_name,
          coalesce(r.used, 0)::int as sessions_used
        from grant_page g
        left join public.pos_tickets t on t.org_id = g.org_id and t.id = g.source_ticket_id
        left join public.fin_products fp on fp.org_id = g.org_id and fp.id = g.package_product_id
        left join (
          select r.grant_id, count(*)::int as used
          from public.pos_package_redemptions r join grant_page g on g.id = r.grant_id
          where r.org_id = ${ctx.tenantId} and r.reversed_at is null
          group by r.grant_id
        ) r on r.grant_id = g.id
      )
      select i.present, i.canonical_kind, i.canonical_id, i.party_id, i.contact_id,
        i.identity_status, i.display_name, policy.pos_currency,
        ((CURRENT_TIMESTAMP at time zone policy.timezone)::date)::text as today,
        coalesce((select jsonb_agg(jsonb_build_object(
          'currency', b.currency, 'balance', b.balance
        ) order by b.currency collate "C") from balances b), '[]'::jsonb) as balances,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'orgId', l.org_id, 'partyId', l.party_id,
          'crmContactId', l.crm_contact_id, 'kind', l.kind, 'amount', l.amount,
          'currency', l.currency, 'ticketId', l.ticket_id, 'planId', l.plan_id,
          'bookingId', l.booking_id, 'note', l.note, 'createdBy', l.created_by,
          'createdAt', l.created_at, 'metadata', l.metadata
        ) order by l.created_at desc, l.id desc) from
          (select * from ledger_page limit 200) l), '[]'::jsonb) as ledger,
        (select count(*) > 200 from ledger_page) as ledger_has_more,
        coalesce((select jsonb_agg(jsonb_build_object(
          'plan', jsonb_build_object(
            'id', p.id, 'orgId', p.org_id, 'partyId', p.party_id,
            'crmContactId', p.crm_contact_id, 'title', p.title,
            'totalAmount', p.total_amount, 'currency', p.currency, 'status', p.status,
            'productId', p.product_id, 'bookingId', p.booking_id,
            'dueSchedule', p.due_schedule, 'note', p.note, 'createdBy', p.created_by,
            'createdAt', p.created_at, 'settledAt', p.settled_at,
            'cancelledAt', p.cancelled_at, 'cancelledBy', p.cancelled_by
          ), 'paidTotal', coalesce(pb.paid_total, 0),
          'ticketCurrencies', coalesce(pb.ticket_currencies, '[]'::jsonb)
        ) order by p.created_at desc, p.id desc)
          from (select * from plan_page limit 100) p
          left join paid_by_plan pb on pb.plan_id = p.id), '[]'::jsonb) as plans,
        (select count(*) > 100 from plan_page) as plans_has_more,
        coalesce((select jsonb_agg(jsonb_build_object(
          'grant', jsonb_build_object(
            'id', g.id, 'orgId', g.org_id, 'partyId', g.party_id,
            'crmContactId', g.crm_contact_id, 'sourceTicketId', g.source_ticket_id,
            'sourceLineId', g.source_line_id, 'packageProductId', g.package_product_id,
            'serviceProductId', g.service_product_id, 'sessionsTotal', g.sessions_total,
            'unitValue', g.unit_value, 'expiresAt', g.expires_at, 'status', g.status,
            'createdAt', g.created_at, 'cancelledAt', g.cancelled_at,
            'cancelledBy', g.cancelled_by
          ), 'sourceCurrency', g.source_currency, 'packageName', g.package_name,
          'sessionsUsed', g.sessions_used
        ) order by g.created_at desc, g.id desc)
          from (select * from grant_enriched limit 100) g), '[]'::jsonb) as grants,
        (select count(*) > 100 from grant_page) as grants_has_more
      from identity i cross join policy
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row || row.present !== true || row.identity_status == null) return null;

    const balanceCurrency = requirePosCurrency(row.pos_currency);
    const balancesByCurrency = parseBalanceBuckets(row.balances);
    const ledger = arrayValue(row.ledger, 'ledger').map((value) => {
      const raw = objectValue(value, 'ledger');
      return checkedLedger({
        id: stringValue(raw.id, 'ledger id'),
        orgId: stringValue(raw.orgId, 'ledger organization'),
        partyId: nullableString(raw.partyId),
        crmContactId: nullableString(raw.crmContactId),
        kind: stringValue(raw.kind, 'ledger kind'),
        amount: String(raw.amount),
        currency: stringValue(raw.currency, 'ledger currency'),
        ticketId: nullableString(raw.ticketId),
        planId: nullableString(raw.planId),
        bookingId: nullableString(raw.bookingId),
        note: nullableString(raw.note),
        createdBy: nullableString(raw.createdBy),
        createdAt: dateValue(raw.createdAt, 'ledger createdAt'),
        metadata: objectValue(raw.metadata ?? {}, 'ledger metadata'),
      });
    });
    const today = stringValue(row.today, 'business date');
    const plans = arrayValue(row.plans, 'plans').map((value) => {
      const envelope = objectValue(value, 'plan');
      const raw = objectValue(envelope.plan, 'plan');
      const plan = checkedPlan({
        id: stringValue(raw.id, 'plan id'),
        orgId: stringValue(raw.orgId, 'plan organization'),
        partyId: nullableString(raw.partyId),
        crmContactId: nullableString(raw.crmContactId),
        title: stringValue(raw.title, 'plan title'),
        totalAmount: String(raw.totalAmount),
        currency: stringValue(raw.currency, 'plan currency'),
        status: stringValue(raw.status, 'plan status'),
        productId: nullableString(raw.productId),
        bookingId: nullableString(raw.bookingId),
        dueSchedule: raw.dueSchedule ?? null,
        note: nullableString(raw.note),
        createdBy: nullableString(raw.createdBy),
        createdAt: dateValue(raw.createdAt, 'plan createdAt'),
        settledAt: nullableDate(raw.settledAt, 'plan settledAt'),
        cancelledAt: nullableDate(raw.cancelledAt, 'plan cancelledAt'),
        cancelledBy: nullableString(raw.cancelledBy),
      });
      for (const currency of arrayValue(envelope.ticketCurrencies, 'plan ticket currencies')) {
        if (requirePosCurrency(currency) !== plan.currency)
          throw new PosError('Plan ticket currency is inconsistent.', 'invalid_stored_amount');
      }
      const paidTotal = storedMinorNumber(storedMoneyMinor(envelope.paidTotal ?? '0'));
      return planDetail(plan, [{ total: String(paidTotal) }]);
    });
    const grants = arrayValue(row.grants, 'grants').map((value): GrantView => {
      const envelope = objectValue(value, 'grant');
      const raw = objectValue(envelope.grant, 'grant');
      const grant: PosPackageGrant = {
        id: stringValue(raw.id, 'grant id'),
        orgId: stringValue(raw.orgId, 'grant organization'),
        partyId: nullableString(raw.partyId),
        crmContactId: nullableString(raw.crmContactId),
        sourceTicketId: stringValue(raw.sourceTicketId, 'grant source ticket'),
        sourceLineId: stringValue(raw.sourceLineId, 'grant source line'),
        packageProductId: stringValue(raw.packageProductId, 'grant package product'),
        serviceProductId: stringValue(raw.serviceProductId, 'grant service product'),
        sessionsTotal: Number(raw.sessionsTotal),
        unitValue: String(raw.unitValue),
        expiresAt: nullableString(raw.expiresAt),
        status: stringValue(raw.status, 'grant status'),
        createdAt: dateValue(raw.createdAt, 'grant createdAt'),
        cancelledAt: nullableDate(raw.cancelledAt, 'grant cancelledAt'),
        cancelledBy: nullableString(raw.cancelledBy),
      };
      if (!Number.isSafeInteger(grant.sessionsTotal) || grant.sessionsTotal < 0)
        throw new PosError('Stored grant sessions are invalid.', 'invalid_stored_amount');
      storedMinorNumber(storedMoneyMinor(grant.unitValue, true));
      const sessionsUsed = Number(envelope.sessionsUsed);
      if (!Number.isSafeInteger(sessionsUsed) || sessionsUsed < 0)
        throw new PosError('Stored grant usage is invalid.', 'invalid_stored_amount');
      if (envelope.sourceCurrency == null)
        throw new PosError('Package monetary provenance is unavailable.', 'invalid_stored_amount');
      const currency = requirePosCurrency(envelope.sourceCurrency);
      return {
        grant,
        currency,
        sessionsUsed,
        sessionsRemaining: remainingSessions(grant.sessionsTotal, sessionsUsed),
        status: grantStatus(
          {
            sessionsTotal: grant.sessionsTotal,
            used: sessionsUsed,
            expiresAt: grant.expiresAt,
            status: grant.status,
          },
          today,
        ),
        packageName: nullableString(envelope.packageName),
      };
    });
    const canonicalKind = stringValue(row.canonical_kind, 'wallet identity');
    const canonicalId = stringValue(row.canonical_id, 'wallet identity');
    const clientKey = `${canonicalKind}:${canonicalId}`;
    return {
      requestedClientKey,
      clientKey,
      client: {
        partyId: nullableString(row.party_id),
        crmContactId: nullableString(row.contact_id),
      },
      identityStatus: String(row.identity_status) as WalletIdentityStatus,
      displayName: nullableString(row.display_name),
      balancesByCurrency,
      balance:
        balancesByCurrency.find((bucket) => bucket.currency === balanceCurrency)?.balance ?? 0,
      balanceCurrency,
      ledger,
      ledgerHasMore: row.ledger_has_more === true,
      grants,
      grantsHasMore: row.grants_has_more === true,
      plans,
      plansHasMore: row.plans_has_more === true,
    };
  });
}
