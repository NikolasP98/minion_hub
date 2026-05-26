import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { getDb } from '$server/db/client';
import { organization, member } from '@minion-stack/db/schema';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('orgs.all', locals.user)) throw error(403, 'Admin access required');
  const db = getDb();
  const orgs = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization);
  const counts = await db
    .select({ orgId: member.organizationId, c: sql<number>`count(*)` })
    .from(member)
    .groupBy(member.organizationId);
  const countMap = new Map(counts.map((c) => [c.orgId, Number(c.c)]));
  return { orgs: orgs.map((o) => ({ ...o, members: countMap.get(o.id) ?? 0 })) };
};
