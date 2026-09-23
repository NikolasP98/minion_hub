import * as m from '$lib/paraglide/messages';
import type { TableDef } from '../registry';

const f = (key: string, label: () => string, editable = false) => ({ key, label, editable });

/**
 * Every user-facing table (see ../registry.ts). Order = settings-page order.
 * Keys that BECOME the ID column (code / number / doc / humanId) are not
 * listed as fields — the table synthesises that column from `idColumn`.
 */
export const TABLE_REGISTRY: readonly TableDef[] = [
  {
    id: 'stock.items',
    module: 'stock',
    label: m.stock_items_title,
    idPrefix: 'ITM-',
    hasId: true,
    fields: [
      f('name', m.stock_col_name, true),
      f('itemGroup', m.stock_col_group, true),
      f('uom', m.stock_col_uom),
      f('tags', m.stock_col_tags),
      f('qtyOnHand', m.stock_col_on_hand),
      f('stockValue', m.stock_col_value),
      f('reorderLevel', m.stock_col_reorder_level, true),
      f('reorderQty', m.stock_col_reorder_qty, true),
      f('moq', m.stock_col_moq, true),
      f('lastRestockCost', m.stock_col_last_restock_cost),
      f('lastSupplierName', m.stock_col_last_supplier),
    ],
  },
  {
    id: 'stock.entries',
    module: 'stock',
    label: m.stock_entries_title,
    idPrefix: 'ENT-',
    hasId: true,
    fields: [
      f('type', m.stock_col_type),
      f('status', m.stock_col_status),
      f('party', m.stock_col_party),
      f('created', m.stock_col_created),
    ],
  },
  {
    id: 'pos.catalog',
    module: 'pos',
    label: m.pos_catalog_title,
    idPrefix: 'SKU-',
    hasId: true,
    fields: [
      f('name', m.stock_col_name),
      f('category', m.fin_col_category, true),
      f('unitPrice', m.pos_sell_price, true),
      f('kind', m.pos_catalog_col_kind),
      f('tags', m.pos_catalog_col_tags, true),
      f('stockQty', m.pos_catalog_col_stock),
      f('hasMapping', m.pos_catalog_col_mapped),
      f('active', m.fin_col_active),
      f('billed', m.fin_col_billed),
      f('revenue', m.fin_col_revenue),
      f('cost', m.fin_col_cost),
      f('margin', m.fin_col_margin),
    ],
  },
  {
    id: 'crm.customers',
    module: 'crm',
    label: m.crm_nav_customers,
    idPrefix: 'CUS-',
    // TODO(handoff): UUID-only today — part 2 adds a per-org sequence column +
    // backfill so the ID reads CUS-000418 (meta proposal
    // 2026-09-21-hub-table-registry-followups). Until then: Title only.
    hasId: false,
    fields: [
      f('name', m.crm_col_contact),
      f('score', m.crm_col_score),
      f('stage', m.crm_col_stage),
      f('funnel', m.crm_funnel_col),
      f('verified', m.crm_col_verified),
      f('sex', m.crm_col_sex),
      f('origin', m.crm_col_origin),
      f('tags', m.tags_label),
      f('revenue', m.crm_col_revenue),
      f('invoices', m.crm_col_invoices),
      f('lastPurchase', m.crm_col_last_purchase),
      f('channels', m.crm_col_channels),
      f('msgs', m.crm_col_msgs),
      f('inbound', m.crm_export_inbound),
      f('outbound', m.crm_export_outbound),
      f('recent', m.crm_col_last_contact),
    ],
  },
  {
    id: 'finances.invoices',
    module: 'finances',
    label: m.fin_invoices_title,
    idPrefix: '',
    hasId: true,
    fields: [
      f('issued', m.fin_col_issued_at),
      f('client', m.fin_col_client),
      f('dni', m.fin_col_dni),
      f('total', m.fin_col_total),
      f('status', m.fin_col_status),
    ],
  },
  {
    id: 'finances.purchases',
    module: 'finances',
    label: m.fin_purchases_title,
    idPrefix: '',
    hasId: true,
    fields: [
      f('supplier', m.fin_purchases_col_supplier),
      f('issuedAt', m.fin_purchases_col_date),
      f('baseGravada', m.fin_purchases_col_base),
      f('igv', m.fin_purchases_col_igv),
      f('total', m.fin_purchases_col_total),
      f('source', m.fin_purchases_col_source),
    ],
  },
  {
    id: 'socials.campaigns',
    module: 'socials',
    label: m.ads_nav_campaigns,
    idPrefix: 'CMP-',
    hasId: true,
    fields: [
      f('preview', m.ads_col_thumbnail),
      f('name', m.ads_col_campaign),
      f('spend', m.ads_col_spend),
      f('impressions', m.ads_col_impressions),
      f('reach', m.ads_col_reach),
      f('clicks', m.ads_col_clicks),
      f('ctr', m.ads_col_ctr),
      f('cpc', m.ads_col_cpc),
      f('conversations', m.ads_col_conversations),
      f('costPerConversation', m.ads_col_cost_per_convo),
    ],
  },
  {
    id: 'team.people',
    module: 'team',
    label: m.nav_team,
    idPrefix: 'EMP-',
    // TODO(handoff): same as crm.customers — numbered in part 2.
    hasId: false,
    fields: [
      f('name', m.team_col_name),
      f('designation', m.team_col_designation),
      f('department', m.team_department),
      f('roles', m.team_col_roles),
      f('status', m.team_col_status),
      f('timeline', m.team_col_timeline),
    ],
  },
];

export const TABLE_BY_ID: ReadonlyMap<string, TableDef> = new Map(
  TABLE_REGISTRY.map((t) => [t.id, t]),
);

/** Module label for the settings page groups. */
export const MODULE_LABELS: Record<string, () => string> = {
  stock: m.nav_stock,
  pos: m.nav_pos,
  crm: m.crm_title,
  finances: m.nav_finances,
  socials: m.nav_marketing,
  team: m.nav_team,
};
