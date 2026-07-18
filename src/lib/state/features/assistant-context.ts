/**
 * Context engineering for the floating assistant.
 *
 * The agent runs on the gateway and only ever receives message TEXT (there is no
 * structured context field on chat.send). So we give it situational awareness the
 * same way the voice-call path does: by prepending a compact context envelope to
 * the message. The clean user text is what shows in the transcript (see
 * sendAssistantTurn) — this envelope is for the model only.
 *
 * Two jobs:
 *  1. Tell the agent WHERE the user is and what's focused (route + params).
 *  2. Tell the agent HOW to act for the user: emit in-app markdown links
 *     `[label](/path)` — they render as clickable navigation (MarkdownMessage
 *     intercepts internal hrefs → SvelteKit goto), so a link IS the "navigate on
 *     the user's behalf, with confirmation" affordance (the click confirms).
 */

import { page } from '$app/state';
import { HUB_ROUTE_MAP, HUB_NOTABLE_PARAMS } from '../../../routes/api/gateway/_shared/hub-route-map';

function describeRoute(pathname: string): string {
	for (const [prefix, desc] of HUB_ROUTE_MAP) {
		if (prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)) return desc;
	}
	return 'A page in the dashboard.';
}

/** A short "what's focused" clause from dynamic id segments + notable query params. */
function describeFocus(pathname: string, params: URLSearchParams): string {
	const bits: string[] = [];

	// A trailing id segment after a known collection (e.g. /crm/<id>) = a focused record.
	const seg = pathname.split('/').filter(Boolean);
	if (seg[0] === 'crm' && seg[1] && seg[1] !== 'customers') {
		bits.push(`focused on customer id ${seg[1]} (link as /crm/${seg[1]})`);
	}

	for (const k of HUB_NOTABLE_PARAMS) {
		const v = params.get(k);
		if (!v) continue;
		if (k === 'contact') bits.push(`filtered to customer id ${v} (link as /crm/${v})`);
		else if (k === 'new') bits.push('a create/new form is open');
		else bits.push(`${k}=${v}`);
	}

	return bits.join('; ');
}

function activeOrg(): { name: string | null; id: string | null; multi: boolean } {
	const data = page.data as
		| { organizations?: Array<{ id: string; name?: string }>; activeOrgId?: string | null }
		| undefined;
	const orgs = data?.organizations ?? [];
	const id = data?.activeOrgId ?? null;
	const name = id ? (orgs.find((o) => o.id === id)?.name ?? null) : null;
	return { name, id, multi: orgs.length > 1 };
}

/**
 * Build the context envelope prepended to the user's message (model-only).
 * Returns '' when there's nothing useful to add (the agent still works plainly).
 */
export function buildAssistantContext(): string {
	const pathname = page.url?.pathname ?? '/';
	const params = page.url?.searchParams ?? new URLSearchParams();

	const org = activeOrg();
	const focus = describeFocus(pathname, params);

	const lines = [
		`[In-app assistant context — the user is in the Minion dashboard${org.name ? ` for ${org.name}` : ''}.`,
		`Current page: ${pathname} — ${describeRoute(pathname)}`,
		focus ? `Focus: ${focus}.` : '',
		// Only when the user belongs to >1 org: hand the active org id to data
		// tools (crm_insight) so they scope to what's on screen, not the default org.
		org.multi && org.id ? `active_org_id: ${org.id} (pass to data tools as orgId).` : '',
		// Site-wide data access: the agent has read tools over the whole org DB, so it
		// should answer from live data on ANY page rather than "I can't see the screen".
		`You can read this org's live data — customers, invoices, payments, sales, ` +
			`bookings, support tickets, memberships, projects, messages — with your tools ` +
			`(crm_insight for top/recent customers, crm_query for any other sorting/grouping/ ` +
			`date-range/percentage question, crm_search for a specific named person, ` +
			`search_crm_conversations for what customers said about a topic across chat ` +
			`history, crm_conversation_themes for pain-point/intent/over-explaining census ` +
			`questions). When the ` +
			`user asks about anything on this or any page, look it up and answer with specifics; ` +
			`don't say you can't see the page.`,
		`To take the user somewhere or cite evidence, write in-app markdown links [label](/path). ` +
			`They render as clickable navigation — a click is the user's confirmation. ` +
			`Always link a customer's name to /crm/{id}, and back up any figure with a link to the ` +
			`filtered view that proves it (e.g. [3 invoices](/finances/invoices?contact={id})).`,
		`Keep replies tight. Don't restate this context.]`,
	].filter(Boolean);

	return lines.join('\n') + '\n\n';
}

/**
 * Context envelope for the CRM Insights chat panel (`/crm/insights`, see
 * CrmInsightsChat.svelte). Frames the same personal agent as a CRM
 * conversation analyst pointed at the two conversation-intelligence tools
 * (gateway-side, landing separately): `search_crm_conversations` for
 * targeted lookups and `crm_conversation_themes` for aggregate/census
 * questions. Same envelope shape and stripping contract as
 * buildAssistantContext (model-only; sendAssistantTurn's caller strips it
 * for display) — the panel shares the personal agent's main session/thread
 * (see CrmInsightsChat.svelte for why), so this just swaps the framing.
 */
export function buildInsightsContext(): string {
	const org = activeOrg();

	const lines = [
		`[In-app assistant context — the user is on the CRM Insights page` +
			`${org.name ? ` for ${org.name}` : ''}, talking to you as a CRM conversation analyst.`,
		`Use \`search_crm_conversations\` for targeted lookups (e.g. "what did people say about ` +
			`pricing?") and \`crm_conversation_themes\` for aggregate questions (pain-point census, ` +
			`over-explaining rate, intent distribution). If a tool isn't available yet, say so plainly ` +
			`instead of guessing at data you can't see.`,
		org.multi && org.id ? `active_org_id: ${org.id} (pass to data tools as orgId).` : '',
		`Always cite how many conversations/messages back a claim, and support it with an in-app ` +
			`markdown link [label](/crm/...) — e.g. a customer name links to /crm/{id}. Links render as ` +
			`clickable navigation.`,
		`Keep replies tight. Don't restate this context.]`,
	].filter(Boolean);

	return lines.join('\n') + '\n\n';
}
