import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

// Phase 1 scaffold: load returns mock curated-feed payload.
// Phase 2 replaces with `myAgent.feedToday()` gateway RPC + real personal-agent
// observations from the message-ledger intercept hook.

export type FeedItemKind = 'task' | 'thread' | 'calendar';

export interface FeedItem {
	id: string;
	kind: FeedItemKind;
	title: string;
	subtitle?: string;
	icon?: string;
}

export interface MyAgentFeedData {
	userName: string;
	greeting: string;
	sections: Array<{ kind: FeedItemKind; label: string; items: FeedItem[] }>;
	moreFromTodayCount: number;
	whatINoticedCount: number;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const userName = locals.user.displayName ?? locals.user.email.split('@')[0];

	const data: MyAgentFeedData = {
		userName,
		greeting:
			'Good to see you. This is a Phase 1 scaffold — the curated feed will replace these placeholders once the personal-agent intercept hook lands.',
		sections: [
			{
				kind: 'task',
				label: 'Tasks',
				items: [
					{ id: 'task-1', kind: 'task', title: 'Review Q2 roadmap', subtitle: 'Mock item' },
					{ id: 'task-2', kind: 'task', title: 'Approve team budget', subtitle: 'Mock item' },
				],
			},
			{
				kind: 'thread',
				label: 'Threads',
				items: [
					{
						id: 'thread-1',
						kind: 'thread',
						title: 'Sussi · WhatsApp · "tomorrow?"',
						subtitle: 'Mock item',
						icon: '💬',
					},
				],
			},
			{
				kind: 'calendar',
				label: 'Calendar',
				items: [
					{
						id: 'cal-1',
						kind: 'calendar',
						title: '3:00 PM · Team standup',
						subtitle: 'Mock item',
						icon: '📅',
					},
				],
			},
		],
		moreFromTodayCount: 9,
		whatINoticedCount: 35,
	};

	return data;
};
