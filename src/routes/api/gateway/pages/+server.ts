import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { HUB_ROUTE_MAP, HUB_NOTABLE_PARAMS } from '../_shared/hub-route-map';

/**
 * GET /api/gateway/pages
 *
 * Serializes the hub's page/route map for the gateway `hub_pages` tool — "what
 * pages exist, what they show, what query params they take" — so the agent can
 * hand the user a navigable deep link over any channel (WhatsApp/Telegram/hub
 * chat), not just describe the page. Static, non-sensitive route metadata: no
 * principal resolution or RBAC needed (same reasoning as /api/marketplace).
 */
export const GET: RequestHandler = async () => {
	const pages = HUB_ROUTE_MAP.map(([route, description]) => ({ route, description }));
	return json({ pages, notableParams: HUB_NOTABLE_PARAMS });
};
