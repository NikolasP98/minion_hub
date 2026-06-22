import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient, workforceRawFetch } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';

type CostTrendPoint = { date: string; cents: number };

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	event.depends('app:dashboard');
	// Wait for the +layout gate (ensureWorkforceCompany) rather than trusting the
	// optimistic companyId hooks set on locals — otherwise this load races the
	// gate and can redirect with the wrong reason (no-company) while the gate is
	// still surfacing the real one (provision-failed / backend-unavailable).
	const { companyId } = await event.parent();
	if (!companyId) throw redirect(302, '/workforce/welcome?reason=no-company');
	const client = workforceServerClient(event);
	try {
		const [summary, badges, activity, costTrend] = await Promise.all([
			client.dashboard.summary(companyId),
			client.sidebarBadges.get(companyId),
			client.activity.list(companyId),
			workforceRawFetch<CostTrendPoint[]>(event, `/api/companies/${companyId}/costs/trend`).catch(
				() => [] as CostTrendPoint[],
			),
		]);
		return { summary, badges, activity, costTrend };
	} catch (e: any) {
		const status = e?.status ?? 502;
		// 404 = the org's mapped Workforce company no longer exists on the backend
		// (stale mapping) — surface the reason-aware welcome instead of a raw error.
		if (status === 404) throw redirect(302, '/workforce/welcome?reason=no-company');
		throw error(status, 'Workforce backend is unavailable');
	}
};
