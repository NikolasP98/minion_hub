import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listMyWork,
  listRules,
  DOC_TYPES,
  type WorkItem,
} from '$server/services/assignment.service';
import { listUsers } from '$server/services/user.service';
import { workforceRawFetch } from '$lib/server/workforce-fetch';
import { workforceWorkItems, type WorkforceWorkItem } from '$lib/workforce/work-queue';

export const load: PageServerLoad = async (event) => {
  const { locals } = event;
  const ctx = await getCoreCtx(locals);
  if (!ctx?.profileId) throw error(401, 'Authentication required');
  event.depends('work:queue');

  const isAdmin = locals.user?.role === 'admin';
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  const workforceIdentity = locals.workforceIdentity;
  const workforceInbox =
    orgId && workforceIdentity
      ? workforceRawFetch<unknown>(event, `/api/companies/${encodeURIComponent(orgId)}/inbox`)
      : Promise.reject(new Error('Workforce identity unavailable'));

  const [items, users, rules, workforceResult] = await Promise.all([
    listMyWork(ctx, ctx.profileId),
    listUsers(ctx).catch(() => []),
    isAdmin ? listRules(ctx) : Promise.resolve([]),
    workforceInbox.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    ),
  ]);
  const workforceItems =
    workforceResult.ok && workforceIdentity
      ? workforceWorkItems(workforceResult.value, {
          userId: workforceIdentity.userId ?? locals.user?.id ?? null,
          roleKeys: workforceIdentity.roleAuthority === 'signed' ? workforceIdentity.roleKeys : [],
        })
      : [];
  const combinedItems: Array<WorkItem | WorkforceWorkItem> = [...items, ...workforceItems];
  combinedItems.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const members = users.map((u) => ({ id: u.id, name: u.displayName ?? u.email ?? u.id }));
  return {
    items: combinedItems,
    members,
    rules,
    isAdmin,
    docTypes: DOC_TYPES,
    workforceQueueAvailable: workforceResult.ok,
  };
};
