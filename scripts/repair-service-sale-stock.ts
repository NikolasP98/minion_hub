/**
 * ONE-TIME repair (meta spec 120, slice S2): give back the supplies that
 * prepaid treatments removed from stock at the sale.
 *
 * Before spec 120 a treatment sold without an appointment issued its recipe at
 * the sale; completing the appointment later issued it again. This rebuilds
 * the stock movement of each affected sale under the current rule (products
 * issue at the sale, treatments at the appointment). It refuses a sale whose
 * rebuild would change anything other than its treatments' supplies.
 *
 * SAFE BY DEFAULT: preview only. Pass --apply to write. Run it twice: the
 * second run must plan nothing.
 *
 * The preview runs every query on ONE connection it has set read-only itself.
 * The Supabase pooler drops read-only startup options, so a flag on the URL or
 * in PGOPTIONS protects nothing. Use the session port (5432): the setting does
 * not hold on the transaction port and the preview then refuses to run.
 *
 *   bun scripts/repair-service-sale-stock.ts --org <org id>
 *   bun scripts/repair-service-sale-stock.ts --org <org id> --apply
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { createServer } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { pathToFileURL } from 'node:url';
import type { CoreCtx } from '../src/server/auth/core-ctx';
import type * as PosService from '../src/server/services/pos.service';

type Deps = Pick<typeof PosService, 'previewTicketRepost' | 'planRepost' | 'repostTicketStock'>;

export interface Candidate {
  ticketId: string;
  sale: string;
  movement: string;
}
export interface PlanRow extends Candidate {
  itemId: string;
  now: number;
  after: number;
  diff: number;
}
export interface OrgPlan {
  rows: PlanRow[];
  refused: (Candidate & { reason: string })[];
  skipped: (Candidate & { reason: string })[];
  totals: Map<string, number>;
}

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code ?? 'error';

/** Plan every candidate sale. Read-only: it never calls the rebuild. */
export async function planOrg(
  deps: Pick<Deps, 'previewTicketRepost' | 'planRepost'>,
  ctx: CoreCtx,
  candidates: Candidate[],
): Promise<OrgPlan> {
  const plan: OrgPlan = { rows: [], refused: [], skipped: [], totals: new Map() };
  for (const c of candidates) {
    let preview;
    try {
      preview = await deps.previewTicketRepost(ctx, c.ticketId);
    } catch (e) {
      plan.skipped.push({ ...c, reason: codeOf(e) });
      continue;
    }
    const { changes, drift } = deps.planRepost(preview.oldByItem, preview.newByItem, {
      allowedItemIds: preview.serviceItemIds,
    });
    if (drift.length) {
      plan.refused.push({
        ...c,
        reason: `stock_drift: ${drift.map((d) => `${d.itemId} ${d.diff}`).join(', ')}`,
      });
      continue;
    }
    for (const ch of changes) {
      plan.rows.push({ ...c, itemId: ch.itemId, now: ch.old, after: ch.new, diff: ch.diff });
      plan.totals.set(ch.itemId, (plan.totals.get(ch.itemId) ?? 0) + ch.diff);
    }
  }
  return plan;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const orgId = args[args.indexOf('--org') + 1];
  if (!args.includes('--org') || !orgId || orgId.startsWith('--'))
    throw new Error('usage: repair-service-sale-stock.ts --org <org id> [--apply]');
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required');

  let db: ReturnType<typeof postgres> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let resetPools: (() => Promise<void>) | undefined;
  try {
    vite = await createServer({
      configFile: false,
      appType: 'custom',
      plugins: [sveltekit()],
      server: { middlewareMode: true, watch: null },
      logLevel: 'error',
    });
    const [{ getCoreDb }, poolModule, pos] = await Promise.all([
      vite.ssrLoadModule('/src/server/db/pg-client.ts') as Promise<{
        getCoreDb: () => CoreCtx['db'];
      }>,
      vite.ssrLoadModule('/src/server/db/pg-pool.ts') as Promise<{
        resetAllPgPools: () => Promise<void>;
        ARRAY_TYPES: Record<string, postgres.PostgresType>;
      }>,
      vite.ssrLoadModule('/src/server/services/pos.service.ts') as Promise<Deps>,
    ]);
    resetPools = poolModule.resetAllPgPools;

    // fetch_types off: the type lookup alone takes ~11 s on this instance.
    const sql = (db = postgres(url, {
      prepare: false,
      max: 1,
      fetch_types: false,
      types: poolModule.ARRAY_TYPES,
      debug: process.env.REPAIR_DEBUG
        ? (_c, q) => console.log('[sql]', q.replace(/\s+/g, ' ').slice(0, 110))
        : undefined,
    }));
    const readOnly = async () =>
      (await sql<{ v: string }[]>`select current_setting('default_transaction_read_only') as v`)[0]
        .v === 'on';
    if (!apply) {
      await sql`set default_transaction_read_only = on`;
      if (!(await readOnly()))
        throw new Error('could not make the connection read-only; use the session port 5432');
    }
    console.log(`[mode] ${apply ? 'APPLY' : 'preview, connection set read-only'}`);

    // Submitted sales whose live movement holds an item that one of the sale's
    // treatment recipes consumes.
    // shortcut: matches recipe items directly, not through kit components
    // (no org has component rows today); join stk_item_components if one does.
    const candidates = await sql<Candidate[]>`
      select distinct t.id::text as "ticketId", t.human_id as sale, e.human_id as movement
      from pos_tickets t
      join stk_entries e on e.id = t.stock_entry_id and e.status = 'submitted'
      join stk_entry_lines el on el.entry_id = e.id
      join pos_ticket_lines l on l.ticket_id = t.id and l.kind <> 'product'
      join stk_consumption c
        on c.org_id = t.org_id and c.fin_product_id = l.fin_product_id and c.item_id = el.item_id
      where t.org_id = ${orgId} and t.status = 'submitted'
      order by t.human_id
    `;
    const [owner] = await sql<{ profile_id: string }[]>`
      select profile_id::text as profile_id from organization_members
      where organization_id::text = ${orgId}
      order by (case role when 'owner' then 0 when 'admin' then 1 else 2 end)
      limit 1
    `;
    if (!owner) throw new Error(`org ${orgId} has no members to act as`);

    // Preview: the services read through the read-only connection, not the app pool.
    const ctx: CoreCtx = {
      db: apply ? getCoreDb() : (drizzle(sql, { schema: pgSchema }) as unknown as CoreCtx['db']),
      tenantId: orgId,
      profileId: owner.profile_id,
    };

    const plan = await planOrg(pos, ctx, candidates);
    const itemIds = [...new Set(plan.rows.map((r) => r.itemId))];
    const names = new Map(
      itemIds.length
        ? (
            await sql<{ id: string; name: string }[]>`
              select id::text as id, name from stk_items where id::text in ${sql(itemIds)}
            `
          ).map((i) => [i.id, i.name])
        : [],
    );
    const name = (id: string) => names.get(id) ?? id;

    console.log(
      `[candidates] ${candidates.length} sales whose live movement holds a treatment supply`,
    );
    console.table(
      plan.rows.map((r) => ({
        sale: r.sale,
        movement: r.movement,
        item: name(r.itemId),
        'issued now': r.now,
        'issued after': r.after,
        difference: r.diff,
      })),
    );
    for (const r of plan.refused) console.log(`[refused] ${r.sale} (${r.movement}): ${r.reason}`);
    for (const s of plan.skipped) console.log(`[skipped] ${s.sale} (${s.movement}): ${s.reason}`);
    console.log('[totals, stock units]');
    console.table([...plan.totals].map(([id, diff]) => ({ item: name(id), difference: diff })));

    if (!apply) {
      if (!(await readOnly())) throw new Error('the connection lost its read-only setting');
      console.log(plan.rows.length ? '[preview] nothing was changed' : '[preview] empty plan');
      return;
    }
    const actor = { id: null, name: 'repair-120' };
    let failed = 0;
    for (const ticketId of new Set(plan.rows.map((r) => r.ticketId))) {
      const row = plan.rows.find((r) => r.ticketId === ticketId)!;
      try {
        const preview = await pos.previewTicketRepost(ctx, ticketId);
        const out = await pos.repostTicketStock(ctx, ticketId, actor, {
          allowedItemIds: preview.serviceItemIds,
        });
        const warning = out.stockWarning ? ` · warning ${out.stockWarning.code}` : '';
        console.log(`[applied] ${row.sale}: ${row.movement} cancelled${warning}`);
        if (out.stockWarning) failed++;
      } catch (e) {
        failed++;
        console.log(`[failed] ${row.sale}: ${codeOf(e)} ${e instanceof Error ? e.message : ''}`);
      }
    }
    // Invariant: a second pass plans nothing.
    const after = await planOrg(pos, ctx, candidates);
    console.log(`[invariant] rows still planned after apply: ${after.rows.length}`);
    if (failed || after.rows.length) process.exitCode = 1;
  } finally {
    await Promise.allSettled([resetPools?.(), vite?.close(), db?.end()]);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) await main();
