import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolvePublicDoor, bumpDoorStat, isLikelyBot } from '$server/services/doors.service';
import { getServerDoorKind } from '$server/doors/kinds';
import { getTenant } from '$server/services/tenant.service';
import type { TenantContext } from '$server/services/base';
import { parseAttribution, type DoorKey } from '$lib/doors/attribution';

/**
 * Public, unauthenticated door page (spec 041 FR-002). One route for every
 * kind: unknown, switched-off, CRM-disabled and unregistered-kind doors all
 * 404 the same way. Never cached, so switching a door off takes effect on the
 * next request (SC-003).
 * TODO(handoff): the root layout sets `ssr = false`, so this page (and S5's FAQ
 * JSON-LD) renders client-side only; crawlers that do not run JS see no content.
 * See proposal 2026-10-24-hub-collection-points-followups §9.
 */
export const load: PageServerLoad = async ({ params, url, request, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const resolved = await resolvePublicDoor(params.slug);
  const server = resolved ? getServerDoorKind(resolved.door.kind) : undefined;
  if (!resolved || !server) throw error(404, 'Not found');
  const { ctx, door } = resolved;
  const doorKey: DoorKey = `door:${door.id}`;
  const attribution = parseAttribution(url, request.headers.get('referer'), url.host, doorKey);
  if (!isLikelyBot(request.headers.get('user-agent'))) await bumpDoorStat(ctx, doorKey, 'views');
  const [data, org] = await Promise.all([
    server.publicView(ctx, door),
    getTenant({ tenantId: ctx.tenantId } as TenantContext).catch(() => null),
  ]);
  return {
    door: { slug: door.slug, title: door.title, description: door.description },
    kind: door.kind,
    data,
    attribution,
    orgName: (org?.name as string | undefined) ?? null,
  };
};
