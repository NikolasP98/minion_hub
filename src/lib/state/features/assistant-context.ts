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

// Longest-prefix wins. Keep descriptions to one line — this is a model briefing,
// not docs. {id} marks where a record id slots into a deep-link.
const ROUTE_MAP: Array<[string, string]> = [
	['/crm/customers', 'CRM customers grid (filterable/sortable list of all customers).'],
	['/crm/', "A single customer's CRM profile — journey, identities, revenue, notes."],
	['/crm', 'CRM dashboard — customer overview, funnel, tags.'],
	['/finances/invoices', 'Invoices list. Filter to one customer with ?contact={id}.'],
	['/finances', 'Finances dashboard — revenue, products, KPIs.'],
	['/sales', 'Sales orders (derived from bookings). Filter with ?contact={id}.'],
	['/support', 'Support tickets + SLA. Filter with ?contact={id}.'],
	['/bookings', 'Appointments / scheduling. Filter with ?contact={id}.'],
	['/book', 'Public booking flow.'],
	['/agents', 'Agents — autonomous + personal agent management.'],
	['/sessions', 'Live agent sessions + transcripts.'],
	['/reliability', 'Reliability KPIs and health metrics.'],
	['/channels', 'Channel integrations (WhatsApp, Telegram, etc.).'],
	['/settings', 'Settings — comms, org, preferences.'],
	['/workshop', 'Workshop canvas — visual agent interaction.'],
	['/flow-editor', 'Agent Builder — visual flow editor.'],
	['/marketplace', 'Agent + skill marketplace.'],
	['/capabilities', 'Capabilities + MCPs.'],
	['/home', 'Personal agent chat (this same assistant, full-screen).'],
	['/', 'Overview / home dashboard.'],
];

// Search params worth surfacing as "what's focused" — anything else is noise.
const NOTABLE_PARAMS = ['contact', 'new', 'q', 'status', 'range', 'source', 'tag'];

function describeRoute(pathname: string): string {
	for (const [prefix, desc] of ROUTE_MAP) {
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

	for (const k of NOTABLE_PARAMS) {
		const v = params.get(k);
		if (!v) continue;
		if (k === 'contact') bits.push(`filtered to customer id ${v} (link as /crm/${v})`);
		else if (k === 'new') bits.push('a create/new form is open');
		else bits.push(`${k}=${v}`);
	}

	return bits.join('; ');
}

function activeOrgName(): string | null {
	const data = page.data as
		| { organizations?: Array<{ id: string; name?: string }>; activeOrgId?: string | null }
		| undefined;
	if (!data?.organizations || !data.activeOrgId) return null;
	return data.organizations.find((o) => o.id === data.activeOrgId)?.name ?? null;
}

/**
 * Build the context envelope prepended to the user's message (model-only).
 * Returns '' when there's nothing useful to add (the agent still works plainly).
 */
export function buildAssistantContext(): string {
	const pathname = page.url?.pathname ?? '/';
	const params = page.url?.searchParams ?? new URLSearchParams();

	const org = activeOrgName();
	const focus = describeFocus(pathname, params);

	const lines = [
		`[In-app assistant context — the user is in the Minion dashboard${org ? ` for ${org}` : ''}.`,
		`Current page: ${pathname} — ${describeRoute(pathname)}`,
		focus ? `Focus: ${focus}.` : '',
		`To take the user somewhere or cite evidence, write in-app markdown links [label](/path). ` +
			`They render as clickable navigation — a click is the user's confirmation. ` +
			`Always link a customer's name to /crm/{id}, and back up any figure with a link to the ` +
			`filtered view that proves it (e.g. [3 invoices](/finances/invoices?contact={id})).`,
		`Keep replies tight. Don't restate this context.]`,
	].filter(Boolean);

	return lines.join('\n') + '\n\n';
}
