import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { crmActivities } from '$server/db/pg-crm-schema';
import { listModuleStates } from './modules.service';
import { issueCountForContact } from './support.service';
import { orderCountForContact } from './sales.service';
import { linkTo } from '$lib/nav/prefill';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * The cross-module "Connections" panel — Minion's port of ERPNext's declarative
 * dashboard (erpnext/.../customer_dashboard.py): the related-record counts shown
 * on an entity page, GENERATED FROM A CONFIG, not hand-built per page.
 *
 * Each group is a module; each item is a linked record type with a live count
 * and a click-through. Counts use the EXISTING soft-links today
 * (sched_bookings.crm_contact_id; the CRM↔Finance phone bridge) — they migrate
 * to party_id once the spine is backfilled, without changing the config shape.
 *
 * ponytail: one resolver + one config array beats a per-entity dashboard
 * component. Add a new linked type = one count branch. Modules default to
 * ENABLED when absent (listModuleStates only returns explicit rows), so each
 * group gates on `!== false`, never on truthiness.
 */

export interface ConnItem {
  key: string;
  label: string;
  count: number;
  /** Click-through; omitted for comingSoon items. */
  href?: string;
  /** "+New" target — create a linked record with the parent pre-filled (ERPNext
   *  `make_new`). Only set for creatable modules. */
  newHref?: string;
  /** Module/feature not built yet — render muted, no link. */
  comingSoon?: boolean;
}
export interface ConnGroup {
  label: string;
  items: ConnItem[];
}

// last-9-digits phone match (Peru), mirrors crm-finance.service's PHONE9.
const P9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);

/**
 * Build the Connections groups for a CRM contact. Groups whose module is
 * explicitly disabled (app_modules row enabled=false) are dropped.
 */
export async function contactConnections(ctx: CoreCtx, contactId: string): Promise<ConnGroup[]> {
  const modules = await listModuleStates(ctx);
  const groups: ConnGroup[] = [];

  await withOrgCore(ctx, async (tx) => {
    // ── Engagement (CRM is implicit — we're on its page) ───────────────────
    const [act] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmActivities)
      .where(and(eq(crmActivities.orgId, ctx.tenantId), eq(crmActivities.contactId, contactId)))) as {
      n: number;
    }[];
    groups.push({
      label: 'Engagement',
      items: [
        {
          key: 'activities',
          label: 'Activities',
          count: Number(act?.n ?? 0),
          href: `/crm/${contactId}`,
        },
      ],
    });

    // ── Scheduling ─────────────────────────────────────────────────────────
    if (modules.scheduling !== false) {
      const [bk] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schedBookings)
        .where(
          and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.crmContactId, contactId)),
        )) as { n: number }[];
      groups.push({
        label: 'Scheduling',
        items: [
          {
            key: 'bookings',
            label: 'Bookings',
            count: Number(bk?.n ?? 0),
            href: linkTo('/scheduling/bookings', { contact: contactId }),
            newHref: linkTo('/scheduling/bookings', { contact: contactId, new: 1 }),
          },
        ],
      });
    }

    // ── Finance (via the phone bridge) ──────────────────────────────────────
    if (modules.finances !== false) {
      const [fin] = (await tx.execute(sql`
        with phones as (
          select ${P9('ci.external_id')} p9 from crm_contact_identities ci
          where ci.org_id = current_setting('app.current_org_id', true)
            and ci.contact_id = ${contactId} and ci.channel = 'whatsapp'
            and length(${P9('ci.external_id')}) >= 8
        ),
        inv as (
          select fi.id from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
          where fc.org_id = current_setting('app.current_org_id', true)
            and ${P9('fc.phone')} in (select p9 from phones)
        )
        select (select count(*) from inv)::int invoices,
               (select count(*) from fin_payments p where p.invoice_id in (select id from inv))::int payments
      `)) as unknown as Array<{ invoices: number; payments: number }>;
      groups.push({
        label: 'Finance',
        items: [
          {
            key: 'invoices',
            label: 'Invoices',
            count: Number(fin?.invoices ?? 0),
            href: `/finances/invoices?contact=${contactId}`,
          },
          {
            key: 'payments',
            label: 'Payments',
            count: Number(fin?.payments ?? 0),
            href: `/finances/payments?contact=${contactId}`,
          },
        ],
      });
    }
  });

  // ── Sales (open orders for this contact) ─────────────────────────────────
  if (modules.sales !== false) {
    const orders = await orderCountForContact(ctx, contactId);
    groups.push({
      label: 'Sales',
      items: [
        {
          key: 'orders',
          label: 'Open orders',
          count: orders,
          href: `/sales?contact=${contactId}`,
        },
      ],
    });
  }

  // ── Support (open tickets for this contact) ──────────────────────────────
  if (modules.support !== false) {
    const tickets = await issueCountForContact(ctx, contactId);
    groups.push({
      label: 'Support',
      items: [
        {
          key: 'tickets',
          label: 'Open tickets',
          count: tickets,
          href: linkTo('/support', { contact: contactId }),
          newHref: linkTo('/support', { contact: contactId, new: 1 }),
        },
      ],
    });
  }

  return groups;
}
