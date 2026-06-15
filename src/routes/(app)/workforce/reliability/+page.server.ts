import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient, paperclipRawFetch } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

type HeatmapAgent = { id: string; name: string; status: string };
type Heatmap = {
	agents: HeatmapAgent[];
	cells: Record<string, number[]>;
	hourLabels: number[];
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:reliability');
	const companyId = event.locals.paperclipIdentity.companyId;
	const client = paperclipServerClient(event);

	try {
		const [heatmap, runs, agents] = await Promise.all([
			paperclipRawFetch<Heatmap>(event, `/api/companies/${companyId}/reliability/heatmap`),
			// Pull a few agents' runs for the "recent failures" section
			Promise.all(
				['19153064-8faf-45d6-9b0c-112de6d368e9', 'a2b3c4d5-0000-0000-0000-111122223333'].map((id) =>
					paperclipRawFetch<any[]>(event, `/api/agents/${id}/runs`).catch(() => [] as any[]),
				),
			),
			client.agents.list(companyId),
		]);
		const allRuns = runs.flat();
		return { heatmap, recentRuns: allRuns, agents };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
