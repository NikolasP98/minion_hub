/**
 * Reference list of `/api/gateway/query/*` and `/api/gateway/actions/*`
 * endpoints a custom tool script may call (Bearer `MINION_HUB_TOKEN`-authed).
 * Generated statically from the inventory in spec §1 — new endpoints should be
 * appended here when added.
 *
 * Shared by `/api/builder/tools/variables` (session editor Module Vars tab,
 * spec C9) and `/api/gateway/query/sdk-catalog` (agent-facing superset, C11) —
 * a single source of truth rather than two copies drifting apart.
 */
export const MODULE_VARS = [
	{ key: 'MINION_HUB_QUERY_TOOL_PERMISSIONS', path: '/api/gateway/query/tool-permissions', description: "The caller's RBAC capability snapshot." },
	{ key: 'MINION_HUB_QUERY_CUSTOM_TOOLS', path: '/api/gateway/query/custom-tools', description: 'Published custom tools for the org.' },
	{ key: 'MINION_HUB_QUERY_NOTES', path: '/api/gateway/query/notes', description: "List the caller's notes/todos/easels." },
	{ key: 'MINION_HUB_QUERY_EMAIL_LEDGER', path: '/api/gateway/query/email-ledger', description: 'Recent processed-email summaries (never content).' },
	{ key: 'MINION_HUB_QUERY_BOOKINGS', path: '/api/gateway/query/bookings', description: 'Upcoming/past bookings.' },
	{ key: 'MINION_HUB_QUERY_FINANCE', path: '/api/gateway/query/finance', description: 'Finance/invoice reads.' },
	{ key: 'MINION_HUB_QUERY_ORDERS', path: '/api/gateway/query/orders', description: 'Sales orders.' },
	{ key: 'MINION_HUB_QUERY_POS', path: '/api/gateway/query/pos', description: 'Point-of-sale reads.' },
	{ key: 'MINION_HUB_QUERY_PROJECTS', path: '/api/gateway/query/projects', description: 'Projects/tasks.' },
	{ key: 'MINION_HUB_QUERY_STOCK', path: '/api/gateway/query/stock', description: 'Stock/inventory reads.' },
	{ key: 'MINION_HUB_QUERY_TICKETS', path: '/api/gateway/query/tickets', description: 'Support tickets.' },
	{ key: 'MINION_HUB_QUERY_SDK_CATALOG', path: '/api/gateway/query/sdk-catalog', description: 'DB schema + module-endpoint catalog (the flashlight).' },
	{ key: 'MINION_HUB_ACTION_NOTE_CREATE', path: '/api/gateway/actions/note-create', description: 'Create a note/todo/easel.' },
	{ key: 'MINION_HUB_ACTION_TOOL_SAVE', path: '/api/gateway/actions/tool-save', description: 'Create/update/publish a custom tool.' },
	{ key: 'MINION_HUB_ACTION_BOOKING_CREATE', path: '/api/gateway/actions/booking-create', description: 'Create a booking.' },
	{ key: 'MINION_HUB_ACTION_BOOKING_RESCHEDULE', path: '/api/gateway/actions/booking-reschedule', description: 'Reschedule a booking.' },
	{ key: 'MINION_HUB_ACTION_BOOKING_CANCEL', path: '/api/gateway/actions/booking-cancel', description: 'Cancel a booking.' },
	{ key: 'MINION_HUB_ACTION_BOOKING_COMPLETE', path: '/api/gateway/actions/booking-complete', description: 'Mark a booking complete.' },
	{ key: 'MINION_HUB_ACTION_CONTACT_TAG', path: '/api/gateway/actions/contact-tag', description: 'Tag a CRM contact.' },
	{ key: 'MINION_HUB_ACTION_CONTACT_UPDATE', path: '/api/gateway/actions/contact-update', description: 'Update a CRM contact.' },
	{ key: 'MINION_HUB_ACTION_NOTIFY_USER', path: '/api/gateway/actions/notify-user', description: 'Notify the org owner/user.' },
	{ key: 'MINION_HUB_ACTION_ORDER_UPDATE_STATUS', path: '/api/gateway/actions/order-update-status', description: 'Update an order status.' },
	{ key: 'MINION_HUB_ACTION_POS_SALE', path: '/api/gateway/actions/pos-sale', description: 'Record a POS sale.' },
	{ key: 'MINION_HUB_ACTION_STOCK_ENTRY_CREATE', path: '/api/gateway/actions/stock-entry-create', description: 'Create a draft stock entry.' },
	{ key: 'MINION_HUB_ACTION_STOCK_ISSUE_FROM_INVOICE', path: '/api/gateway/actions/stock-issue-from-invoice', description: 'Issue stock from an invoice.' },
	{ key: 'MINION_HUB_ACTION_STOCK_ISSUE_FROM_SERVICE', path: '/api/gateway/actions/stock-issue-from-service', description: 'Issue stock from a service.' },
	{ key: 'MINION_HUB_ACTION_TASK_CREATE', path: '/api/gateway/actions/task-create', description: 'Create a project task.' },
	{ key: 'MINION_HUB_ACTION_TASK_UPDATE', path: '/api/gateway/actions/task-update', description: 'Update a project task.' },
	{ key: 'MINION_HUB_ACTION_TICKET_CREATE', path: '/api/gateway/actions/ticket-create', description: 'Create a support ticket.' },
	{ key: 'MINION_HUB_ACTION_TICKET_UPDATE', path: '/api/gateway/actions/ticket-update', description: 'Update a support ticket.' },
	{ key: 'MINION_HUB_ACTION_TICKET_COMMENT', path: '/api/gateway/actions/ticket-comment', description: 'Comment on a support ticket.' },
] as const;
