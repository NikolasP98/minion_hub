import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { listModuleStates } from './modules.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Global record search — the "jump to any record" half of an ERPNext awesomebar
 * (the command palette already covers pages/actions). Light ILIKE over the
 * searchable entities: contacts, support tickets, sales orders — by name,
 * human_id, or key text. Returns a flat, ranked-enough list the palette renders.
 */
export interface SearchHit {
  type: 'contact' | 'ticket' | 'order';
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
  icon: string; // command-palette iconMap key
}

export async function searchRecords(ctx: CoreCtx, query: string, perType = 5): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const modules = await listModuleStates(ctx);

  return withOrgCore(ctx, async (tx) => {
    const hits: SearchHit[] = [];

    // Contacts (CRM is always on for the palette context).
    const contacts = (await tx.execute(sql`
      select id, display_name, human_id
      from crm_contacts
      where org_id = current_setting('app.current_org_id', true) and deleted_at is null
        and (display_name ilike ${like} or human_id ilike ${like})
      order by updated_at desc limit ${perType}
    `)) as unknown as Array<{ id: string; display_name: string | null; human_id: string | null }>;
    for (const c of contacts)
      hits.push({
        type: 'contact',
        id: c.id,
        label: c.display_name || 'Unnamed contact',
        sublabel: c.human_id,
        href: `/crm/${c.id}`,
        icon: 'user',
      });

    if (modules.support !== false) {
      const tickets = (await tx.execute(sql`
        select id, subject, human_id, status
        from support_issues
        where org_id = current_setting('app.current_org_id', true)
          and (subject ilike ${like} or human_id ilike ${like})
        order by created_at desc limit ${perType}
      `)) as unknown as Array<{ id: string; subject: string; human_id: string | null; status: string }>;
      for (const t of tickets)
        hits.push({
          type: 'ticket',
          id: t.id,
          label: t.subject,
          sublabel: [t.human_id, t.status].filter(Boolean).join(' · ') || null,
          href: `/support/${t.id}`,
          icon: 'inbox',
        });
    }

    if (modules.sales !== false) {
      const orders = (await tx.execute(sql`
        select id, description, human_id, customer_name
        from sales_orders
        where org_id = current_setting('app.current_org_id', true)
          and (description ilike ${like} or human_id ilike ${like} or customer_name ilike ${like})
        order by created_at desc limit ${perType}
      `)) as unknown as Array<{ id: string; description: string | null; human_id: string | null; customer_name: string | null }>;
      for (const o of orders)
        hits.push({
          type: 'order',
          id: o.id,
          label: o.description || o.human_id || 'Order',
          sublabel: [o.human_id, o.customer_name].filter(Boolean).join(' · ') || null,
          href: `/sales`, // no per-order detail page yet; land on the list
          icon: 'folder',
        });
    }

    return hits;
  });
}
