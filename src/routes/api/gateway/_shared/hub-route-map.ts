/**
 * Single source of truth for "what pages does the hub have" — consumed by:
 *  - `$lib/state/features/assistant-context.ts` (in-app floating assistant briefing)
 *  - `GET /api/gateway/pages` (gateway tool `hub_pages`, same info over WhatsApp/Telegram)
 *
 * Lives under src/routes/api/gateway/ (not src/lib) so both call sites share
 * ONE definition without adding a new file outside the gateway-action surface.
 *
 * Longest-prefix wins. Keep descriptions to one line — this is a model
 * briefing, not docs. {id} marks where a record id slots into a deep-link.
 */
export const HUB_ROUTE_MAP: Array<[route: string, description: string]> = [
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
	[
		'/overview',
		'Overview dashboard — org map + key business metrics at a glance. Proactively look up live data (top customers, recent activity, revenue) before answering instead of describing the page.',
	],
	['/', 'Overview / home dashboard — proactively look up live data before answering.'],
];

/** Search params worth surfacing as "what's focused" — anything else is noise. */
export const HUB_NOTABLE_PARAMS = ['contact', 'new', 'q', 'status', 'range', 'source', 'tag'] as const;
