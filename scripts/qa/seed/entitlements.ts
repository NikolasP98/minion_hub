/**
 * Org entitlements (spec 043 S1, pairs with migration 20261029100000_org_entitlements.sql).
 * One Premium QA org (the main business org) and one Base QA org (the modules-off
 * org). Inert while ENTITLEMENTS_ENFORCED is off. Local QA DB only.
 */
import { ORG_BUSINESS, ORG_MODULES_OFF } from './tenancy';
import type { SeedContext } from './db';

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register } = ctx;
  await sql`
    insert into org_plans (org_id, plan_key, set_note) values
      (${ORG_BUSINESS}, 'premium', 'qa-seed'),
      (${ORG_MODULES_OFF}, 'base', 'qa-seed')
    on conflict (org_id) do update set plan_key = excluded.plan_key, set_note = excluded.set_note
  `;
  register('entitlements.org.premium', { table: 'org_plans', where: { org_id: ORG_BUSINESS } });
  register('entitlements.org.base', { table: 'org_plans', where: { org_id: ORG_MODULES_OFF } });
}
