import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getFinSettings } from '$server/services/finance.service';
import { supabaseAdmin } from '$server/supabase';

/** The 7 system vars the gateway injects at custom-tool run time (spec C9). */
const SYSTEM_VARS = [
  { key: 'MINION_AGENT_ID', description: 'The gateway agent id running this tool.' },
  { key: 'MINION_ORG_ID', description: "The tool owner's organization id." },
  { key: 'MINION_USER_ID', description: "The tool owner's profile id." },
  { key: 'MINION_GATEWAY_URL', description: 'Base URL of the gateway that ran this tool.' },
  { key: 'MINION_HUB_URL', description: 'Base URL of this hub instance.' },
  { key: 'MINION_TOOL_ID', description: 'This custom tool\'s id.' },
  { key: 'MINION_TOOL_NAME', description: 'This custom tool\'s name.' },
] as const;

/**
 * Reference list of `/api/gateway/query/*` and `/api/gateway/actions/*`
 * endpoints a custom tool script may call (Bearer `MINION_HUB_TOKEN`-authed).
 * Generated statically from the inventory in spec §1 — new endpoints should be
 * appended here when added.
 */
const MODULE_VARS = [
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
  { key: 'MINION_HUB_ACTION_NOTE_CREATE', path: '/api/gateway/actions/note-create', description: 'Create a note/todo/easel.' },
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

/**
 * GET /api/builder/tools/variables — data for the editor's Env/System/Module/
 * Database variable tabs (spec C9). Gated on `tools.view` like the rest of
 * /api/builder/tools*.
 */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'tools', 'view');
  const ctx = await requireCoreCtx(locals);

  const [{ data: org }, finSettings] = await Promise.all([
    supabaseAdmin().from('organizations').select('name').eq('id', ctx.tenantId).maybeSingle(),
    getFinSettings(ctx),
  ]);

  const database = [
    {
      key: 'MINION_DB_ORG_NAME',
      value: (org as { name?: string } | null)?.name ?? '',
      description: "The organization's display name.",
    },
    { key: 'MINION_DB_CURRENCY', value: finSettings.currency, description: 'Display currency (fin_settings, defaults to PEN).' },
    // ponytail: no per-org timezone/locale column exists yet — static defaults
    // until an org-settings field lands (no migration warranted for two strings).
    { key: 'MINION_DB_TIMEZONE', value: 'America/Lima', description: "The org's default timezone." },
    { key: 'MINION_DB_LOCALE', value: 'es-PE', description: "The org's default locale." },
  ];

  return json({ system: SYSTEM_VARS, module: MODULE_VARS, database });
};
