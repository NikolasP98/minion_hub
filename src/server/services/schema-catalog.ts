import { getTableColumns, getTableName } from 'drizzle-orm';

// Org-scoped BUSINESS tables only — no auth/system tables (user, session,
// account, verification, jwks) and no pure-infra tables (bg_jobs, flows,
// workshop_experiments, brains*, app_modules, plugin_org_disabled, …). These
// are the tables an agent-authored custom-tool script would plausibly query
// via the hub's `/api/gateway/query/*` surface (spec C11).
import {
	finInvoices,
	finInvoiceItems,
	finPayments,
	finClients,
	finProducts,
	finSources,
	finSyncJobs,
	finSettings,
} from '$server/db/pg-finance-schema';
import {
	schedResources,
	schedSchedules,
	schedAvailability,
	schedEventTypes,
	schedEventTypeResources,
	schedBookings,
	schedLinks,
} from '$server/db/pg-scheduling-schema';
import { schedReminderConfig, schedReminders } from '$server/db/pg-reminders-schema';
import { posSettings, posShifts, posTickets, posTicketLines, posPayments } from '$server/db/pg-pos-schema';
import { projProjects, projTasks, projTimesheets, projTemplates } from '$server/db/pg-projects-schema';
import { parties } from '$server/db/pg-party-schema';
import { supportIssues, supportSettings } from '$server/db/pg-support-schema';
import {
	crmContacts,
	crmContactIdentities,
	crmActivities,
	crmTags,
	crmContactTags,
	crmSettings,
	crmMessageSentiment,
	crmWinEmbeddings,
} from '$server/db/pg-crm-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { notes } from '$server/db/pg-schema/notes';
import { emailLedger, emailLedgerSettings } from '$server/db/pg-schema/email-ledger';
import {
	stkItems,
	stkWarehouses,
	stkEntries,
	stkEntryLines,
	stkLedger,
	stkBins,
	stkConsumption,
	stkAccruals,
} from '$server/db/pg-schema/stock';

/** ponytail: a plain array of PgTable-likes is enough — no registry class. */
const CATALOG_TABLES = [
	finInvoices,
	finInvoiceItems,
	finPayments,
	finClients,
	finProducts,
	finSources,
	finSyncJobs,
	finSettings,
	schedResources,
	schedSchedules,
	schedAvailability,
	schedEventTypes,
	schedEventTypeResources,
	schedBookings,
	schedLinks,
	schedReminderConfig,
	schedReminders,
	posSettings,
	posShifts,
	posTickets,
	posTicketLines,
	posPayments,
	projProjects,
	projTasks,
	projTimesheets,
	projTemplates,
	parties,
	supportIssues,
	supportSettings,
	crmContacts,
	crmContactIdentities,
	crmActivities,
	crmTags,
	crmContactTags,
	crmSettings,
	crmMessageSentiment,
	crmWinEmbeddings,
	salesOrders,
	notes,
	emailLedger,
	emailLedgerSettings,
	stkItems,
	stkWarehouses,
	stkEntries,
	stkEntryLines,
	stkLedger,
	stkBins,
	stkConsumption,
	stkAccruals,
];

export interface SchemaCatalogColumn {
	name: string;
	type: string;
}

export interface SchemaCatalogTable {
	name: string;
	columns: SchemaCatalogColumn[];
}

// Static per build (schema is fixed at compile time) — compute once.
let catalogCache: SchemaCatalogTable[] | null = null;

/** `{ tables: [{ name, columns: [{name, type}] }] }` — SQL table/column names
 *  (not JS field names), so this doubles as the SQL-completion source (C10). */
export function getSchemaCatalog(): SchemaCatalogTable[] {
	if (catalogCache) return catalogCache;
	catalogCache = CATALOG_TABLES.map((table) => {
		const columns = getTableColumns(table);
		return {
			name: getTableName(table),
			columns: Object.values(columns).map((col) => ({
				name: col.name,
				type: col.getSQLType(),
			})),
		};
	});
	return catalogCache;
}
