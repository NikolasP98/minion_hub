/**
 * Spec 043 S5 launch backfill: every org becomes Premium except Bernibites, which gets an
 * explicit Base row. Owner-run against prod; dry run by default.
 *
 *   SUPABASE_DB_URL=... bun scripts/entitlements/backfill-launch-plans.ts
 *   SUPABASE_DB_URL=... bun scripts/entitlements/backfill-launch-plans.ts --apply --expect-base <bernibites-uuid>
 *
 * Apply snapshots org_plans to scripts/entitlements/snapshots/ (gitignored), then writes in one
 * transaction with org_plan_events audit rows (actor NULL, note 'launch-backfill') and asserts
 * the end state before committing. Idempotent: a second run plans 0 writes.
 * The hub's 5-minute entitlements cache is not invalidated; with ENTITLEMENTS_ENFORCED off
 * (the launch order) that changes nothing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

export const FACES_ORG_ID = '21e0601b-f632-43fd-8414-d644af4271f4';
export const NOTE = 'launch-backfill';
const BASE_ORG = 'bernibites';

export interface OrgState {
  id: string;
  name: string;
  slug: string | null;
  plan_key: string | null;
}
export interface PlannedChange {
  orgId: string;
  name: string;
  from: string | null;
  to: 'base' | 'premium';
}
export type Tx = postgres.TransactionSql;

/** Bernibites by name (its slug may be null) or slug; exactly one match or refuse. */
export function resolveBaseOrg(orgs: OrgState[]): OrgState {
  const matches = orgs.filter(
    (o) => o.name.toLowerCase().includes(BASE_ORG) || o.slug?.toLowerCase().includes(BASE_ORG),
  );
  if (matches.length !== 1) {
    const names = matches.map((o) => `${o.name} (${o.id})`).join(', ');
    throw new Error(
      `expected exactly one Bernibites org, found ${matches.length}${names ? `: ${names}` : ''}`,
    );
  }
  return matches[0];
}

/** Null when fine, else the refusal message. */
export function checkExpectBase(
  apply: boolean,
  expectBase: string | undefined,
  baseId: string,
): string | null {
  if (!apply) return null;
  if (!expectBase)
    return '--apply needs --expect-base <uuid> (the Bernibites id the dry run printed)';
  return expectBase.toLowerCase() === baseId.toLowerCase()
    ? null
    : `--expect-base ${expectBase} does not match the resolved Bernibites id ${baseId}`;
}

export function checkConnection(env: Record<string, string | undefined>): string | null {
  if (env.VITEST) return 'refusing to run under a test runner';
  if (env.HUB_TEST_DB_URL)
    return 'HUB_TEST_DB_URL is set; unset it so test and prod targets cannot mix';
  if (!env.SUPABASE_DB_URL?.trim()) return 'SUPABASE_DB_URL is not set';
  return null;
}

export function planChanges(orgs: OrgState[], baseId: string): PlannedChange[] {
  return orgs.flatMap((o) => {
    const to = o.id === baseId ? 'base' : 'premium';
    return o.plan_key === to ? [] : [{ orgId: o.id, name: o.name, from: o.plan_key, to }];
  });
}

export function project(orgs: OrgState[], changes: PlannedChange[]): OrgState[] {
  const next = new Map(changes.map((c) => [c.orgId, c.to]));
  return orgs.map((o) => ({ ...o, plan_key: next.get(o.id) ?? o.plan_key }));
}

/** The launch end state; returns every violated invariant (empty = holds). */
export function checkInvariants(orgs: OrgState[], baseId: string): string[] {
  const failures: string[] = [];
  const notPremium = orgs.filter((o) => o.plan_key !== 'premium');
  if (notPremium.length !== 1) {
    failures.push(
      `expected exactly one org not Premium, found ${notPremium.length}: ${notPremium.map((o) => o.name).join(', ')}`,
    );
  }
  const base = orgs.find((o) => o.id === baseId);
  if (base?.plan_key !== 'base')
    failures.push(`Bernibites is ${base?.plan_key ?? 'missing'}, expected base`);
  const faces = orgs.find((o) => o.id === FACES_ORG_ID);
  if (faces?.plan_key !== 'premium')
    failures.push(`FACES is ${faces ? (faces.plan_key ?? 'no row') : 'missing'}, expected premium`);
  return failures;
}

async function readState(db: postgres.Sql | Tx): Promise<OrgState[]> {
  return (await db`
    select o.id::text as id, o.name, o.slug, p.plan_key
    from public.organizations o left join public.org_plans p on p.org_id = o.id
    order by o.name, o.id`) as unknown as OrgState[];
}

/** Runs inside `sql.begin`: any throw here rolls the whole write back. */
export async function applyInTransaction(tx: Tx, expectBase: string): Promise<PlannedChange[]> {
  // Blocks a concurrent /orgs/plans change between our read and our write.
  await tx`lock table public.org_plans in share row exclusive mode`;
  const before = await readState(tx);
  const base = resolveBaseOrg(before);
  const refusal = checkExpectBase(true, expectBase, base.id);
  if (refusal) throw new Error(refusal);
  const changes = planChanges(before, base.id);
  for (const c of changes) {
    await tx`
      insert into public.org_plans (org_id, plan_key, set_by_profile_id, set_note, set_at)
      values (${c.orgId}, ${c.to}, null, ${NOTE}, now())
      on conflict (org_id) do update
        set plan_key = excluded.plan_key, set_by_profile_id = null,
            set_note = excluded.set_note, set_at = excluded.set_at`;
    await tx`
      insert into public.org_plan_events (org_id, from_plan, to_plan, actor_profile_id, note)
      values (${c.orgId}, ${c.from}, ${c.to}, null, ${NOTE})`;
  }
  const failures = checkInvariants(await readState(tx), base.id);
  if (failures.length) {
    throw new Error(`post-write assertions failed; rolled back:\n  ${failures.join('\n  ')}`);
  }
  return changes;
}

function printPlan(changes: PlannedChange[]): void {
  console.log(`planned writes: ${changes.length}`);
  for (const c of changes)
    console.log(`  ${c.orgId}  ${c.name}: ${c.from ?? '(no row)'} -> ${c.to}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const flag = args.indexOf('--expect-base');
  const expectBase = flag >= 0 ? args[flag + 1] : undefined;

  const refused = checkConnection(process.env);
  if (refused) throw new Error(refused);
  const sql = postgres(process.env.SUPABASE_DB_URL!.trim(), { prepare: false, max: 1 });
  try {
    const orgs = await readState(sql);
    const base = resolveBaseOrg(orgs);
    console.log(`mode: ${apply ? 'apply' : 'dry run'}  orgs: ${orgs.length}`);
    console.log(`Bernibites (stays Base): ${base.id}  ${base.name}`);
    const refusal = checkExpectBase(apply, expectBase, base.id);
    if (refusal) throw new Error(refusal);

    const changes = planChanges(orgs, base.id);
    printPlan(changes);
    if (!apply) {
      const failures = checkInvariants(project(orgs, changes), base.id);
      console.log(
        `projected assertions: ${failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'pass'}`,
      );
      if (failures.length) process.exitCode = 1;
      return;
    }

    const snapshots = new URL('./snapshots/', import.meta.url);
    await mkdir(snapshots, { recursive: true, mode: 0o700 });
    const file = new URL(
      `org_plans-${new Date().toISOString().replaceAll(':', '-')}.json`,
      snapshots,
    );
    const rows = await sql`select * from public.org_plans order by org_id`;
    await writeFile(file, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2), {
      mode: 0o600,
    });
    console.log(`snapshot: ${file.pathname} (${rows.length} rows)`);

    const written = await sql.begin((tx) => applyInTransaction(tx, expectBase!));
    console.log(`committed: ${written.length} writes; assertions pass`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
