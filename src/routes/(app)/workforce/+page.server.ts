import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient, paperclipRawFetch } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

type CostTrendPoint = { date: string; cents: number };

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	event.depends('app:dashboard');
	const companyId = event.locals.paperclipIdentity?.companyId;
	if (!companyId) throw redirect(302, '/workforce/welcome?reason=no-company');
	const client = paperclipServerClient(event);
	try {
		const [summary, badges, activity, costTrend] = await Promise.all([
			client.dashboard.summary(companyId),
			client.sidebarBadges.get(companyId),
			client.activity.list(companyId),
			paperclipRawFetch<CostTrendPoint[]>(event, `/api/companies/${companyId}/costs/trend`).catch(
				() => [] as CostTrendPoint[],
			),
		]);
		return { summary, badges, activity, costTrend };
	} catch (e: any) {
		const status = e?.status ?? 502;
		// 404 = the org's mapped Paperclip company no longer exists on the backend
		// (stale mapping) — surface the reason-aware welcome instead of a raw error.
		if (status === 404) throw redirect(302, '/workforce/welcome?reason=no-company');
		throw error(status, 'Workforce backend (Paperclip) is unavailable');
	}
};
