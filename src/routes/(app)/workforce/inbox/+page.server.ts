import { redirect } from '@sveltejs/kit';
import { workforceServerClient, workforceRawFetch } from '$lib/server/workforce-fetch';
import { normalizeInboxResponse, type InboxItem } from '$lib/workforce/pipeline-inbox';
import type { PageServerLoad } from './$types';

export type { InboxItem } from '$lib/workforce/pipeline-inbox';

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login');
  const { companyId, workforceAvailable } = await event.parent();
  if (!companyId) {
    throw redirect(302, '/workforce/welcome?reason=no-company');
  }
  event.depends('app:inbox');
  const viewerRoleKeys =
    event.locals.workforceIdentity?.roleAuthority === 'signed'
      ? event.locals.workforceIdentity.roleKeys
      : [];
  const viewerUserId = event.locals.workforceIdentity?.userId ?? event.locals.user.id;

  // This route is a native shell: a stopped execution backend must not replace
  // it with the Workforce 502 page. Actions remain unavailable until live data
  // can be fetched again.
  if (!workforceAvailable || !event.locals.workforceIdentity) {
    return {
      items: [] as InboxItem[],
      agentNames: {} as Record<string, string>,
      workforceAvailable: false,
      liveInboxAvailable: false,
    };
  }

  const client = workforceServerClient(event);
  const [inboxResult, agentsResult] = await Promise.allSettled([
    workforceRawFetch<unknown>(event, `/api/companies/${companyId}/inbox`),
    client.agents.list(companyId),
  ]);

  if (inboxResult.status === 'rejected') {
    console.warn(
      '[workforce/inbox] live Inbox fetch failed; rendering native shell',
      inboxResult.reason,
    );
  }
  if (agentsResult.status === 'rejected') {
    console.warn(
      '[workforce/inbox] agent-name fetch failed; rendering without names',
      agentsResult.reason,
    );
  }

  const items =
    inboxResult.status === 'fulfilled'
      ? normalizeInboxResponse(inboxResult.value, {
          userId: viewerUserId,
          roleKeys: viewerRoleKeys,
        })
      : [];
  const agentNames: Record<string, string> = {};
  if (agentsResult.status === 'fulfilled') {
    for (const agent of agentsResult.value) agentNames[agent.id] = agent.name;
  }

  return {
    items,
    agentNames,
    workforceAvailable,
    liveInboxAvailable: inboxResult.status === 'fulfilled',
  };
};
