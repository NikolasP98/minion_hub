import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { knowledgeSources, type KnowledgeSource } from '$server/db/pg-schema/brains';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import {
  ensureMasterBrain,
  KNOWLEDGE_EMBEDDING_MODEL,
  knowledgeContentHash,
  type NormalizedKnowledgeChunk,
} from './brain-corpus.service';
import { embedTexts, embeddingsEnabled, toVectorLiteral } from './embeddings';
import type { Module } from './rbac.service';

export const BUSINESS_CONNECTOR = 'hub-business';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CHUNK_MAX_CHARS = 6000;
const EMBEDDING_BATCH_SIZE = 64;

export type BusinessKnowledgeDomainKey =
  | 'stock'
  | 'crm'
  | 'socials'
  | 'finances'
  | 'schedules'
  | 'org-chart'
  | 'projects'
  | 'sales'
  | 'pos'
  | 'memberships'
  | 'support'
  | 'operations'
  | 'email'
  | 'pulse';

export interface BusinessTableDefinition {
  table: string;
  recordType?: string;
  orgColumn?: 'org_id' | 'organization_id';
  idExpression?: string;
  cursorExpression?: string;
  titleExpression: string;
  occurredAtExpression?: string;
  updatedAtExpression?: string;
  excludedFields?: readonly string[];
}

export interface BusinessKnowledgeDomainDefinition {
  key: BusinessKnowledgeDomainKey;
  requiredModule: Module;
  name: string;
  description: string;
  limitations?: readonly string[];
  requiredFieldLevel?: 0 | 1;
  tables: readonly BusinessTableDefinition[];
}

/** Reviewed, fail-closed fields. A new DB column is invisible until added here. */
export const BUSINESS_FIELD_ALLOWLISTS: Readonly<Record<string, readonly string[]>> = {
  stk_items: [
    'id',
    'code',
    'name',
    'uom',
    'item_group',
    'is_stock_item',
    'reorder_level',
    'reorder_qty',
    'moq',
    'default_supplier_party_id',
    'consumption_uom',
    'units_per_stock_uom',
    'subunits_per_stock_uom',
    'valuation_method',
    'fin_product_id',
    'updated_at',
  ],
  stk_warehouses: ['id', 'name', 'parent_id', 'is_default', 'updated_at'],
  stk_entries: [
    'id',
    'human_id',
    'type',
    'status',
    'party_id',
    'note',
    'posted_at',
    'created_at',
    'updated_at',
  ],
  stk_bins: ['item_id', 'warehouse_id', 'qty', 'valuation_rate', 'updated_at'],
  stk_consumption: ['id', 'fin_product_id', 'item_id', 'qty_per_unit', 'note', 'updated_at'],
  stk_accruals: [
    'id',
    'source',
    'source_id',
    'fin_product_id',
    'item_id',
    'warehouse_id',
    'qty_consumption',
    'qty',
    'est_unit_cost',
    'est_value',
    'status',
    'realized_entry_id',
    'realized_qty',
    'realized_value',
    'created_at',
    'updated_at',
    'realized_at',
    'released_at',
  ],
  stk_item_components: [
    'id',
    'parent_item_id',
    'child_item_id',
    'qty',
    'optional',
    'default_included',
    'choice_group',
    'note',
    'updated_at',
  ],
  crm_contacts: [
    'id',
    'human_id',
    'display_name',
    'profile_id',
    'owner_id',
    'party_id',
    'lifecycle_override',
    'source',
    'custom_fields',
    'deleted_at',
    'updated_at',
  ],
  crm_contact_identities: ['id', 'contact_id', 'channel', 'external_id', 'handle', 'created_at'],
  crm_activities: ['id', 'contact_id', 'kind', 'body', 'actor_id', 'data', 'occurred_at'],
  crm_tags: ['id', 'name', 'color', 'kind', 'rule', 'position', 'created_at'],
  crm_contact_tags: ['contact_id', 'tag_id', 'applied_by', 'applied_at'],
  crm_conversation_analysis: [
    'channel',
    'chat_id',
    'contact_id',
    'primary_intent',
    'pain_points',
    'asked_for',
    'answered_summary',
    'over_answered',
    'over_answered_reason',
    'msg_count',
    'first_at',
    'last_at',
    'analyzed_at',
  ],
  meta_assets: [
    'id',
    'kind',
    'external_id',
    'name',
    'parent_page_id',
    'currency',
    'enabled',
    'created_at',
  ],
  meta_post_insights: [
    'platform',
    'post_id',
    'caption',
    'media_type',
    'posted_at',
    'is_promoted',
    'metric',
    'period',
    'value',
    'fetched_at',
  ],
  meta_ad_insights: [
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'date',
    'currency',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'fetched_at',
  ],
  meta_lead_attribution: [
    'id',
    'channel',
    'sender_id',
    'chat_id',
    'first_message_id',
    'first_contact_at',
    'origin',
    'source',
    'ref',
    'ad_id',
    'adset_id',
    'campaign_id',
    'campaign_name',
    'ad_title',
    'provenance',
    'confidence',
    'captured_at',
    'updated_at',
  ],
  fin_clients: [
    'id',
    'provider',
    'provider_ref',
    'name',
    'doc_type',
    'doc_number',
    'email',
    'phone',
    'party_id',
  ],
  fin_invoices: [
    'id',
    'provider',
    'provider_ref',
    'number',
    'document_id',
    'issued_at',
    'client_id',
    'client_name',
    'client_doc_type',
    'client_doc_number',
    'client_email',
    'currency',
    'subtotal',
    'tax',
    'discount',
    'total',
    'status',
    'seller',
    'note',
    'synced_at',
    'created_at',
  ],
  fin_products: ['id', 'code', 'name', 'category', 'unit_price', 'active', 'updated_at'],
  fin_settings: [
    'currency',
    'tax_rate',
    'timezone',
    'fx_base',
    'fx_quote',
    'fx_mode',
    'fx_manual_rate',
    'fx_auto_rate',
    'fx_updated_at',
    'updated_at',
  ],
  sched_resources: [
    'id',
    'kind',
    'profile_id',
    'name',
    'email',
    'timezone',
    'active',
    'updated_at',
  ],
  sched_schedules: ['id', 'resource_id', 'name', 'timezone', 'is_default', 'updated_at'],
  sched_availability: ['id', 'schedule_id', 'days', 'start_time', 'end_time', 'date'],
  sched_event_types: [
    'id',
    'slug',
    'title',
    'description',
    'length',
    'slot_interval',
    'before_buffer',
    'after_buffer',
    'minimum_booking_notice',
    'period_type',
    'period_days',
    'scheduling_type',
    'use_custom_schedule',
    'schedule_rules',
    'requires_confirmation',
    'public',
    'product_id',
    'active',
    'updated_at',
  ],
  sched_event_type_resources: ['event_type_id', 'resource_id'],
  sched_bookings: [
    'id',
    'uid',
    'event_type_id',
    'resource_id',
    'start_time',
    'end_time',
    'status',
    'title',
    'notes',
    'attendee_name',
    'attendee_email',
    'attendee_phone',
    'crm_contact_id',
    'party_id',
    'product_id',
    'source',
    'rescheduled_from_id',
    'updated_at',
  ],
  sched_links: [
    'id',
    'slug',
    'title',
    'description',
    'event_type_ids',
    'resource_id',
    'active',
    'expires_at',
    'updated_at',
  ],
  parties: [
    'id',
    'type',
    'name',
    'agent_id',
    'phone9',
    'email',
    'doc_type',
    'doc_number',
    'dob',
    'dni_verified',
    'updated_at',
  ],
  org_areas: [
    'id',
    'name',
    'slug',
    'sort_order',
    'agent_ids',
    'user_ids',
    'skill_keys',
    'integration_keys',
    'virtual_agents',
    'updated_at',
  ],
  org_roles: ['key', 'name', 'rank', 'source_role_key', 'created_at'],
  member_roles: ['profile_id', 'role_key'],
  organization_members: ['profile_id', 'role'],
  proj_projects: [
    'id',
    'human_id',
    'name',
    'description',
    'status',
    'customer_party_id',
    'lead_party_id',
    'target_date',
    'started_at',
    'completed_at',
    'archived_at',
    'updated_at',
  ],
  proj_tasks: [
    'id',
    'project_id',
    'parent_id',
    'milestone_id',
    'is_milestone',
    'human_id',
    'title',
    'description',
    'status',
    'priority',
    'assignee_party_id',
    'est_minutes',
    'sort_order',
    'started_at',
    'completed_at',
    'cancelled_at',
    'updated_at',
  ],
  proj_timesheets: [
    'id',
    'project_id',
    'task_id',
    'party_id',
    'spent_date',
    'minutes',
    'description',
    'billable',
    'billing_rate_cents',
    'updated_at',
  ],
  proj_templates: ['id', 'name', 'description', 'spec', 'archived_at', 'updated_at'],
  sales_orders: [
    'id',
    'human_id',
    'source_booking_id',
    'party_id',
    'crm_contact_id',
    'customer_name',
    'owner_id',
    'event_type_id',
    'product_id',
    'description',
    'quantity',
    'unit_price',
    'total',
    'currency',
    'status',
    'invoice_provider_ref',
    'created_at',
    'updated_at',
  ],
  pos_settings: ['methods', 'currency', 'require_customer', 'allow_price_override', 'updated_at'],
  pos_shifts: [
    'id',
    'status',
    'opened_by',
    'opened_at',
    'opening_float',
    'closed_by',
    'closed_at',
    'expected',
    'counted',
    'note',
    'updated_at',
  ],
  pos_tickets: [
    'id',
    'human_id',
    'shift_id',
    'party_id',
    'crm_contact_id',
    'customer_name',
    'status',
    'subtotal',
    'discount',
    'total',
    'currency',
    'note',
    'stock_entry_id',
    'invoice_provider_ref',
    'submitted_at',
    'voided_at',
  ],
  membership_plans: [
    'id',
    'name',
    'price',
    'currency',
    'interval_unit',
    'interval_count',
    'enabled',
    'updated_at',
  ],
  memberships: [
    'id',
    'plan_id',
    'crm_contact_id',
    'party_id',
    'customer_name',
    'status',
    'started_at',
    'next_cycle_date',
    'cycle_no',
    'updated_at',
  ],
  membership_cycles: [
    'id',
    'membership_id',
    'cycle_no',
    'period_start',
    'period_end',
    'sales_order_id',
    'created_at',
  ],
  support_issues: [
    'id',
    'human_id',
    'subject',
    'description',
    'status',
    'priority',
    'party_id',
    'crm_contact_id',
    'owner_id',
    'source',
    'channel',
    'response_by',
    'resolution_by',
    'first_responded_at',
    'resolved_at',
    'closed_at',
    'created_at',
    'updated_at',
  ],
  support_settings: ['value', 'updated_at'],
  doc_comments: [
    'id',
    'ref_type',
    'ref_id',
    'kind',
    'body',
    'actor_id',
    'actor_name',
    'parent_id',
    'created_at',
  ],
  workflow_defs: ['id', 'doc_type', 'name', 'enabled', 'states', 'transitions', 'updated_at'],
  assignment_rules: [
    'id',
    'name',
    'enabled',
    'doc_type',
    'strategy',
    'assignees',
    'condition',
    'updated_at',
  ],
  notif_rules: [
    'id',
    'name',
    'enabled',
    'trigger_table',
    'trigger_event',
    'date_field',
    'date_offset_mins',
    'condition',
    'channel',
    'template',
    'updated_at',
  ],
  email_ledger: [
    'id',
    'mailbox',
    'from_domain',
    'subject',
    'summary',
    'labels',
    'processed_at',
    'expires_at',
  ],
  pulse_proposals: [
    'id',
    'created_at',
    'source',
    'kind',
    'title',
    'summary',
    'status',
    'decided_by',
    'executed_at',
  ],
};

/**
 * Deliberately selected business systems of record. Each domain becomes one
 * knowledge_source; each row becomes a stable `<table>:<primary-key>` document.
 * Derived vector/index caches and append-only operational logs are not copied.
 */
export const BUSINESS_KNOWLEDGE_DOMAINS: readonly BusinessKnowledgeDomainDefinition[] = [
  {
    key: 'stock',
    requiredModule: 'stock',
    name: 'Stock & Inventory',
    description: 'Items, warehouses, transactions, balances, consumption, accruals, and recipes.',
    tables: [
      {
        table: 'stk_items',
        titleExpression: 'coalesce(r.name, r.code, r.id::text)',
        updatedAtExpression: 'r.updated_at',
      },
      { table: 'stk_warehouses', titleExpression: 'r.name', updatedAtExpression: 'r.updated_at' },
      {
        table: 'stk_entries',
        titleExpression: "coalesce(r.human_id, r.type || ' ' || r.id::text)",
        occurredAtExpression: 'coalesce(r.posted_at, r.created_at)',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'stk_bins',
        idExpression: "r.item_id::text || ':' || r.warehouse_id::text",
        titleExpression: "'Stock balance ' || r.item_id::text || ' @ ' || r.warehouse_id::text",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'stk_consumption',
        titleExpression: "'Consumption rule ' || r.id::text",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'stk_accruals',
        titleExpression: "'Stock accrual ' || r.id::text",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'stk_item_components',
        titleExpression:
          "'Recipe component ' || r.parent_item_id::text || ' -> ' || r.child_item_id::text",
        updatedAtExpression: 'r.updated_at',
      },
    ],
  },
  {
    key: 'crm',
    requiredModule: 'crm',
    name: 'CRM',
    description:
      'Contacts, channel identities, relationship activity, tags, and conversation analysis.',
    limitations: [
      'crm_conversation_analysis has the legacy primary key (org_id, channel, chat_id) and no account_id; its document identity mirrors that row key and must not be reused for account-aware records.',
    ],
    requiredFieldLevel: 1,
    tables: [
      {
        table: 'crm_contacts',
        titleExpression: "coalesce(r.display_name, r.human_id, 'Contact ' || r.id::text)",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'crm_contact_identities',
        titleExpression: "r.channel || ' identity ' || coalesce(r.handle, r.external_id)",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.created_at',
      },
      {
        table: 'crm_activities',
        titleExpression: "'CRM ' || r.kind || ' for ' || r.contact_id::text",
        occurredAtExpression: 'r.occurred_at',
        updatedAtExpression: 'r.occurred_at',
      },
      {
        table: 'crm_tags',
        titleExpression: "'CRM tag ' || r.name",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.created_at',
      },
      {
        table: 'crm_contact_tags',
        idExpression: "r.contact_id::text || ':' || r.tag_id::text",
        titleExpression: "'Contact tag ' || r.contact_id::text || ' / ' || r.tag_id::text",
        occurredAtExpression: 'r.applied_at',
        updatedAtExpression: 'r.applied_at',
      },
      {
        table: 'crm_conversation_analysis',
        idExpression: "r.channel || ':' || r.chat_id",
        titleExpression: "'Conversation analysis ' || r.channel || ' / ' || r.chat_id",
        occurredAtExpression: 'r.last_at',
        updatedAtExpression: 'r.analyzed_at',
        excludedFields: ['model'],
      },
    ],
  },
  {
    key: 'socials',
    requiredModule: 'ads',
    name: 'Socials',
    description:
      'Connected social assets, organic posts, advertising performance, and lead attribution.',
    tables: [
      {
        table: 'meta_assets',
        titleExpression: "coalesce(r.name, r.kind || ' ' || r.external_id)",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.created_at',
        excludedFields: ['connection_id', 'page_token_ciphertext', 'page_token_iv', 'source_url'],
      },
      {
        table: 'meta_post_insights',
        cursorExpression: "r.platform || ':' || r.post_id",
        titleExpression: "upper(r.platform) || ' post ' || r.post_id || ' / ' || r.metric",
        occurredAtExpression: 'coalesce(r.posted_at, r.fetched_at)',
        updatedAtExpression: 'r.fetched_at',
        excludedFields: ['permalink'],
      },
      {
        table: 'meta_ad_insights',
        cursorExpression: "r.ad_id || ':' || to_char(date_trunc('month', r.date), 'YYYY-MM')",
        titleExpression: "coalesce(r.ad_name, 'Ad ' || r.ad_id) || ' / ' || r.date::text",
        occurredAtExpression: 'r.date::timestamptz',
        updatedAtExpression: 'r.fetched_at',
      },
      {
        table: 'meta_lead_attribution',
        titleExpression: "'Lead attribution ' || r.channel || ' / ' || r.sender_id",
        occurredAtExpression: 'coalesce(r.first_contact_at, r.captured_at)',
        updatedAtExpression: 'r.updated_at',
        excludedFields: ['photo_url', 'video_url', 'match_meta'],
      },
    ],
  },
  {
    key: 'finances',
    requiredModule: 'finance',
    name: 'Finances',
    requiredFieldLevel: 1,
    description: 'Invoices, line items, payments, customers, products, and accounting preferences.',
    tables: [
      {
        table: 'fin_invoices',
        titleExpression: "coalesce(r.document_id, r.number, 'Invoice ' || r.provider_ref)",
        occurredAtExpression: 'coalesce(r.issued_at, r.created_at)',
        updatedAtExpression: 'r.synced_at',
      },
      {
        table: 'fin_clients',
        titleExpression: "coalesce(r.name, 'Finance client ' || r.provider_ref)",
      },
      {
        table: 'fin_products',
        titleExpression: 'coalesce(r.name, r.code)',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'fin_settings',
        idExpression: "'settings'",
        titleExpression: "'Finance settings'",
        updatedAtExpression: 'r.updated_at',
        excludedFields: ['fx_source'],
      },
    ],
  },
  {
    key: 'schedules',
    requiredModule: 'scheduling',
    name: 'Schedules',
    requiredFieldLevel: 1,
    description: 'Resources, availability, services, appointments, and public scheduling links.',
    tables: [
      { table: 'sched_resources', titleExpression: 'r.name', updatedAtExpression: 'r.updated_at' },
      { table: 'sched_schedules', titleExpression: 'r.name', updatedAtExpression: 'r.updated_at' },
      {
        table: 'sched_availability',
        titleExpression: "'Availability ' || r.schedule_id::text || ' / ' || r.id::text",
      },
      {
        table: 'sched_event_types',
        titleExpression: 'r.title',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'sched_event_type_resources',
        idExpression: "r.event_type_id::text || ':' || r.resource_id::text",
        titleExpression:
          "'Service-resource assignment ' || r.event_type_id::text || ' / ' || r.resource_id::text",
      },
      {
        table: 'sched_bookings',
        titleExpression: "coalesce(r.title, 'Booking ' || r.uid)",
        occurredAtExpression: 'r.start_time',
        updatedAtExpression: 'r.updated_at',
      },
      { table: 'sched_links', titleExpression: 'r.title', updatedAtExpression: 'r.updated_at' },
    ],
  },
  {
    key: 'org-chart',
    requiredModule: 'users',
    requiredFieldLevel: 1,
    name: 'Organization & People',
    description:
      'Hub departments, memberships, roles, people, companies, and AI-agent participants.',
    limitations: [
      'Paperclip reporting lines are outside the Hub database and require a separately authorized connector; this source does not claim to represent them.',
    ],
    tables: [
      {
        table: 'parties',
        titleExpression: "coalesce(r.name, initcap(r.type) || ' ' || r.id::text)",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'org_areas',
        orgColumn: 'organization_id',
        titleExpression: 'r.name',
        updatedAtExpression: 'r.updated_at',
        excludedFields: ['color', 'icon'],
      },
      {
        table: 'org_roles',
        idExpression: 'r.key',
        titleExpression: "'Role · ' || r.name",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.created_at',
      },
      {
        table: 'member_roles',
        idExpression: "r.profile_id::text || ':' || r.role_key",
        titleExpression: "'Member role · ' || r.profile_id::text || ' / ' || r.role_key",
        excludedFields: ['granted_by'],
      },
      {
        table: 'organization_members',
        orgColumn: 'organization_id',
        idExpression: 'r.profile_id::text',
        titleExpression: "'Organization member · ' || r.profile_id::text",
      },
    ],
  },
  {
    key: 'projects',
    requiredModule: 'projects',
    name: 'Projects',
    description: 'Projects, milestones, tasks, time entries, and reusable project templates.',
    tables: [
      {
        table: 'proj_projects',
        titleExpression: "coalesce(r.human_id || ' · ', '') || r.name",
        occurredAtExpression: 'coalesce(r.started_at, r.created_at)',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'proj_tasks',
        titleExpression: "coalesce(r.human_id || ' · ', '') || r.title",
        occurredAtExpression: 'coalesce(r.started_at, r.created_at)',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'proj_timesheets',
        titleExpression: "'Time entry ' || r.spent_date::text || ' / ' || r.party_id::text",
        occurredAtExpression: 'r.spent_date::timestamptz',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'proj_templates',
        titleExpression: "'Project template · ' || r.name",
        updatedAtExpression: 'r.updated_at',
      },
    ],
  },
  {
    key: 'sales',
    requiredModule: 'sales',
    name: 'Sales',
    description: 'Commercial sales-order commitments and invoice reconciliation status.',
    tables: [
      {
        table: 'sales_orders',
        titleExpression: "coalesce(r.human_id, 'Sales order ' || r.id::text)",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.updated_at',
      },
    ],
  },
  {
    key: 'pos',
    requiredModule: 'pos',
    name: 'Point of Sale',
    description: 'Register settings, shifts, tickets, line items, and tender records.',
    tables: [
      {
        table: 'pos_settings',
        idExpression: "'settings'",
        titleExpression: "'Point-of-sale settings'",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'pos_shifts',
        titleExpression: "'POS shift ' || r.id::text",
        occurredAtExpression: 'r.opened_at',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'pos_tickets',
        titleExpression: "coalesce(r.human_id, 'POS ticket ' || r.id::text)",
        occurredAtExpression: 'r.submitted_at',
        updatedAtExpression: 'coalesce(r.voided_at, r.submitted_at)',
      },
    ],
  },
  {
    key: 'memberships',
    requiredModule: 'memberships',
    name: 'Memberships',
    description: 'Recurring plans, customer memberships, and generated billing cycles.',
    tables: [
      { table: 'membership_plans', titleExpression: 'r.name', updatedAtExpression: 'r.updated_at' },
      {
        table: 'memberships',
        titleExpression: "coalesce(r.customer_name, 'Membership ' || r.id::text)",
        occurredAtExpression: 'r.started_at',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'membership_cycles',
        titleExpression:
          "'Membership cycle ' || r.cycle_no::text || ' / ' || r.membership_id::text",
        occurredAtExpression: 'r.period_start',
        updatedAtExpression: 'r.created_at',
      },
    ],
  },
  {
    key: 'support',
    requiredModule: 'support',
    name: 'Support',
    description: 'Customer support issues, priorities, ownership, and SLA state.',
    tables: [
      {
        table: 'support_issues',
        titleExpression: "coalesce(r.human_id || ' · ', '') || r.subject",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'support_settings',
        idExpression: "'settings'",
        titleExpression: "'Support settings'",
        updatedAtExpression: 'r.updated_at',
      },
      {
        table: 'doc_comments',
        titleExpression: "'Comment on ' || r.ref_type || ' ' || r.ref_id::text",
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'r.created_at',
      },
    ],
  },
  {
    key: 'operations',
    requiredModule: 'flows',
    name: 'Business Operations',
    description: 'Workflow definitions, assignment policies, and notification rules.',
    tables: [
      { table: 'workflow_defs', titleExpression: 'r.name', updatedAtExpression: 'r.updated_at' },
      {
        table: 'assignment_rules',
        titleExpression: 'r.name',
        updatedAtExpression: 'r.updated_at',
        excludedFields: ['cursor'],
      },
      {
        table: 'notif_rules',
        titleExpression: 'r.name',
        updatedAtExpression: 'r.updated_at',
        excludedFields: ['account_id', 'recipients', 'last_run_at'],
      },
    ],
  },
  {
    key: 'email',
    requiredModule: 'comms',
    name: 'Email Knowledge',
    description:
      'Privacy-minimized processed email subjects, summaries, labels, and sender domains.',
    tables: [
      {
        table: 'email_ledger',
        titleExpression:
          "coalesce(r.subject, 'Email from ' || coalesce(r.from_domain, 'unknown sender'))",
        occurredAtExpression: 'r.processed_at',
        updatedAtExpression: 'r.processed_at',
        excludedFields: ['gmail_message_id', 'user_id'],
      },
    ],
  },
  {
    key: 'pulse',
    requiredModule: 'pulse',
    name: 'Pulse Decisions',
    description: 'Operational proposals and their decision or execution status.',
    tables: [
      {
        table: 'pulse_proposals',
        titleExpression: 'r.title',
        occurredAtExpression: 'r.created_at',
        updatedAtExpression: 'coalesce(r.executed_at, r.created_at)',
        excludedFields: ['payload', 'dedup_key', 'error'],
      },
    ],
  },
] as const;

/** Explicit audit boundary: these real tables are intentionally not corpus sources. */
export const BUSINESS_KNOWLEDGE_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  meta_connections: 'contains encrypted access tokens and granted OAuth scopes',
  fin_sources: 'contains connector configuration and secret references',
  fin_sync_jobs: 'background-job state, cursors, and errors',
  meta_sync_jobs: 'background-job state, cursors, and errors',
  bg_jobs: 'generic background-job infrastructure',
  stk_ledger:
    'append-only valuation event stream; normalized stock entities and balances are indexed instead',
  doc_audit_log: 'high-volume field-level audit deltas',
  notif_log: 'notification delivery audit and recipient data',
  sched_reminders: 'notification delivery audit and recipient data',
  email_opens: 'tracking telemetry rather than organization knowledge',
  crm_conversation_chunks:
    'derived embedding cache; canonical WhatsApp corpus is indexed separately',
  crm_win_embeddings: 'derived embedding cache',
  crm_conversation_index: 'derived indexing watermark',
  crm_message_sentiment: 'per-message derived signal',
  meta_post_media: 'media mirroring operational state and expiring source URLs',
  notes: 'personal user-scoped content must not be promoted into an org-wide Master Brain',
  flow_runs: 'execution logs and event blobs',
  workshop_comparison_runs: 'experimental execution data',
  workshop_groupchat_runs: 'experimental execution data',
};

export const BUSINESS_PARENT_AGGREGATES: Readonly<Record<string, string>> = {
  stk_entry_lines: 'stk_entries',
  fin_invoice_items: 'fin_invoices',
  fin_payments: 'fin_invoices',
  pos_ticket_lines: 'pos_tickets',
  pos_payments: 'pos_tickets',
  meta_post_insights: 'one document per platform/post',
  meta_ad_insights: 'one document per ad/UTC-month',
  meta_ad_posts: 'meta_ad_insights ad/UTC-month document',
};

/** Parent-level aggregates for high-cardinality child/telemetry tables. */
const CUSTOM_BUSINESS_TABLE_QUERIES: Readonly<Record<string, string>> = {
  stk_entries: `
    select 'stk_entries:' || r.id::text as external_id, r.id as cursor_id,
      'stk_entries'::text as record_type,
      coalesce(r.human_id, r.type || ' ' || r.id::text)::text as title,
      jsonb_build_object(
        'id', r.id, 'human_id', r.human_id, 'type', r.type, 'status', r.status,
        'party_id', r.party_id, 'note', r.note, 'posted_at', r.posted_at,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'item_id', line.item_id, 'qty', line.qty, 'uom', line.uom,
            'rate', line.rate, 'from_warehouse_id', line.from_warehouse_id,
            'to_warehouse_id', line.to_warehouse_id, 'line_no', line.line_no
          ) order by line.line_no, line.id)
          from stk_entry_lines line
          where line.org_id = r.org_id and line.entry_id = r.id
        ), '[]'::jsonb)
      ) as payload,
      coalesce(r.posted_at, r.created_at)::timestamptz as occurred_at,
      r.updated_at::timestamptz as source_updated_at
    from stk_entries r
    where r.org_id = current_setting('app.current_org_id', true)
      /*__CURSOR_PREDICATE__*/
  `,
  meta_post_insights: `
    select 'meta_post_insights:' || r.platform || ':' || r.post_id as external_id,
      r.platform || ':' || r.post_id as cursor_id,
      'meta_post'::text as record_type,
      upper(r.platform) || ' post ' || r.post_id as title,
      jsonb_build_object(
        'platform', r.platform, 'post_id', r.post_id,
        'caption', max(r.caption), 'media_type', max(r.media_type),
        'posted_at', max(r.posted_at), 'is_promoted', bool_or(r.is_promoted),
        'metrics', jsonb_object_agg(r.metric || ':' || r.period, r.value order by r.metric, r.period)
      ) as payload,
      coalesce(max(r.posted_at), max(r.fetched_at))::timestamptz as occurred_at,
      max(r.fetched_at)::timestamptz as source_updated_at
    from meta_post_insights r
    where r.org_id = current_setting('app.current_org_id', true)
      /*__CURSOR_PREDICATE__*/
    group by r.platform, r.post_id
  `,
  meta_ad_insights: `
    select 'meta_ad_insights:' || r.ad_id || ':' || to_char(date_trunc('month', r.date), 'YYYY-MM') as external_id,
      r.ad_id || ':' || to_char(date_trunc('month', r.date), 'YYYY-MM') as cursor_id,
      'meta_ad_month'::text as record_type,
      coalesce(max(r.ad_name), 'Ad ' || r.ad_id) || ' / ' || to_char(date_trunc('month', r.date), 'YYYY-MM') as title,
      jsonb_build_object(
        'ad_id', r.ad_id, 'ad_name', max(r.ad_name),
        'adset_id', max(r.adset_id), 'adset_name', max(r.adset_name),
        'campaign_id', max(r.campaign_id), 'campaign_name', max(r.campaign_name),
        'month', to_char(date_trunc('month', r.date), 'YYYY-MM'),
        'currency', max(r.currency), 'spend', sum(r.spend),
        'impressions', sum(r.impressions), 'reach', sum(r.reach),
        'clicks', sum(r.clicks),
        'ctr', case when sum(r.impressions) > 0 then sum(r.clicks)::numeric / sum(r.impressions) else null end,
        'linked_post_id', max(link.post_id)
      ) as payload,
      date_trunc('month', r.date)::timestamptz as occurred_at,
      max(r.fetched_at)::timestamptz as source_updated_at
    from meta_ad_insights r
    left join meta_ad_posts link on link.org_id = r.org_id and link.ad_id = r.ad_id
    where r.org_id = current_setting('app.current_org_id', true)
      /*__CURSOR_PREDICATE__*/
    group by r.ad_id, date_trunc('month', r.date)
  `,
  fin_invoices: `
    select 'fin_invoices:' || r.id::text as external_id, r.id as cursor_id,
      'fin_invoice'::text as record_type,
      coalesce(r.document_id, r.number, 'Invoice ' || r.provider_ref)::text as title,
      jsonb_build_object(
        'id', r.id, 'provider', r.provider, 'provider_ref', r.provider_ref,
        'number', r.number, 'document_id', r.document_id, 'issued_at', r.issued_at,
        'client_id', r.client_id, 'client_name', r.client_name,
        'client_doc_type', r.client_doc_type, 'client_doc_number', r.client_doc_number,
        'client_email', r.client_email, 'currency', r.currency,
        'subtotal', r.subtotal, 'tax', r.tax, 'discount', r.discount,
        'total', r.total, 'status', r.status, 'seller', r.seller, 'note', r.note,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_id', item.product_id, 'code', item.code, 'description', item.description,
            'category', item.category, 'quantity', item.quantity, 'unit_price', item.unit_price,
            'discount', item.discount, 'tax', item.tax, 'total', item.total
          ) order by item.id)
          from fin_invoice_items item where item.org_id = r.org_id and item.invoice_id = r.id
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'provider_ref', payment.provider_ref, 'method', payment.method,
            'paid_at', payment.paid_at, 'amount', payment.amount, 'status', payment.status
          ) order by payment.paid_at, payment.id)
          from fin_payments payment where payment.org_id = r.org_id and payment.invoice_id = r.id
        ), '[]'::jsonb)
      ) as payload,
      coalesce(r.issued_at, r.created_at)::timestamptz as occurred_at,
      r.synced_at::timestamptz as source_updated_at
    from fin_invoices r
    where r.org_id = current_setting('app.current_org_id', true)
      /*__CURSOR_PREDICATE__*/
  `,
  pos_tickets: `
    select 'pos_tickets:' || r.id::text as external_id, r.id as cursor_id,
      'pos_ticket'::text as record_type,
      coalesce(r.human_id, 'POS ticket ' || r.id::text)::text as title,
      jsonb_build_object(
        'id', r.id, 'human_id', r.human_id, 'shift_id', r.shift_id,
        'party_id', r.party_id, 'crm_contact_id', r.crm_contact_id,
        'customer_name', r.customer_name, 'status', r.status,
        'subtotal', r.subtotal, 'discount', r.discount, 'total', r.total,
        'currency', r.currency, 'note', r.note, 'stock_entry_id', r.stock_entry_id,
        'invoice_provider_ref', r.invoice_provider_ref, 'submitted_at', r.submitted_at,
        'voided_at', r.voided_at,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', line.kind, 'fin_product_id', line.fin_product_id,
            'booking_id', line.booking_id, 'description', line.description,
            'qty', line.qty, 'unit_price', line.unit_price, 'discount', line.discount,
            'total', line.total, 'line_no', line.line_no, 'modifiers', line.modifiers
          ) order by line.line_no, line.id)
          from pos_ticket_lines line where line.org_id = r.org_id and line.ticket_id = r.id
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'method', payment.method, 'amount', payment.amount,
            'tendered', payment.tendered, 'paid_at', payment.paid_at
          ) order by payment.paid_at, payment.id)
          from pos_payments payment where payment.org_id = r.org_id and payment.ticket_id = r.id
        ), '[]'::jsonb)
      ) as payload,
      r.submitted_at::timestamptz as occurred_at,
      coalesce(r.voided_at, r.submitted_at)::timestamptz as source_updated_at
    from pos_tickets r
    where r.org_id = current_setting('app.current_org_id', true)
      /*__CURSOR_PREDICATE__*/
  `,
};

const CUSTOM_QUERY_REQUIRED_COLUMNS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  stk_entries: {
    stk_entries: [
      'id',
      'org_id',
      'human_id',
      'type',
      'status',
      'party_id',
      'note',
      'posted_at',
      'created_at',
      'updated_at',
    ],
    stk_entry_lines: [
      'id',
      'org_id',
      'entry_id',
      'item_id',
      'qty',
      'uom',
      'rate',
      'from_warehouse_id',
      'to_warehouse_id',
      'line_no',
    ],
  },
  meta_post_insights: {
    meta_post_insights: [
      'org_id',
      'platform',
      'post_id',
      'caption',
      'media_type',
      'posted_at',
      'is_promoted',
      'metric',
      'period',
      'value',
      'fetched_at',
    ],
  },
  meta_ad_insights: {
    meta_ad_insights: [
      'org_id',
      'ad_id',
      'ad_name',
      'adset_id',
      'adset_name',
      'campaign_id',
      'campaign_name',
      'date',
      'currency',
      'spend',
      'impressions',
      'reach',
      'clicks',
      'fetched_at',
    ],
    meta_ad_posts: ['org_id', 'ad_id', 'post_id'],
  },
  fin_invoices: {
    fin_invoices: [
      'id',
      'org_id',
      'provider',
      'provider_ref',
      'number',
      'document_id',
      'issued_at',
      'client_id',
      'client_name',
      'client_doc_type',
      'client_doc_number',
      'client_email',
      'currency',
      'subtotal',
      'tax',
      'discount',
      'total',
      'status',
      'seller',
      'note',
      'synced_at',
      'created_at',
    ],
    fin_invoice_items: [
      'id',
      'org_id',
      'invoice_id',
      'product_id',
      'code',
      'description',
      'category',
      'quantity',
      'unit_price',
      'discount',
      'tax',
      'total',
    ],
    fin_payments: [
      'id',
      'org_id',
      'invoice_id',
      'provider_ref',
      'method',
      'paid_at',
      'amount',
      'status',
    ],
  },
  pos_tickets: {
    pos_tickets: [
      'id',
      'org_id',
      'human_id',
      'shift_id',
      'party_id',
      'crm_contact_id',
      'customer_name',
      'status',
      'subtotal',
      'discount',
      'total',
      'currency',
      'note',
      'stock_entry_id',
      'invoice_provider_ref',
      'submitted_at',
      'voided_at',
    ],
    pos_ticket_lines: [
      'id',
      'org_id',
      'ticket_id',
      'kind',
      'fin_product_id',
      'booking_id',
      'description',
      'qty',
      'unit_price',
      'discount',
      'total',
      'line_no',
      'modifiers',
    ],
    pos_payments: ['id', 'org_id', 'ticket_id', 'method', 'amount', 'tendered', 'paid_at'],
  },
};

export interface BusinessKnowledgeCursor {
  domain: BusinessKnowledgeDomainKey;
  tableIndex: number;
  lastId: string | null;
}

export interface BusinessKnowledgeRecord {
  externalId: string;
  recordType: string;
  title: string;
  payload: Record<string, unknown>;
  occurredAt: Date | null;
  sourceUpdatedAt: Date | null;
}

export interface NormalizedBusinessDocument {
  externalId: string;
  title: string;
  rawText: string;
  normalizedText: string;
  contentHash: string;
  sourceRevision: string;
  occurredAt: Date;
  sourceUpdatedAt: Date;
  metadata: Record<string, unknown>;
  chunks: NormalizedKnowledgeChunk[];
}

export interface BusinessBackfillResult {
  domain: BusinessKnowledgeDomainKey;
  processed: number;
  changedDocuments: number;
  changedChunks: number;
  embeddedChunks: number;
  unchangedChunks: number;
  deletedDocuments: number;
  deletedChunks: number;
  nextCursor: string | null;
  hasMore: boolean;
}

interface BusinessRecordRow {
  external_id: string;
  cursor_id: string;
  record_type: string;
  title: string;
  payload: Record<string, unknown> | string;
  occurred_at: Date | string | null;
  source_updated_at: Date | string | null;
}

interface ExistingDocumentRow {
  id: string;
  external_id: string;
  content_hash: string;
}

interface ExistingChunkRow {
  document_id: string;
  chunk_key: string;
  content_hash: string;
  embedding_model: string | null;
  has_embedding: boolean;
}

interface PreparedBusinessDocument {
  sourceId: string;
  documentId: string;
  document: NormalizedBusinessDocument;
  changedDocument: boolean;
  changedChunkKeys: Set<string>;
  staleChunkKeys: string[];
}

const SENSITIVE_KEY =
  /(secret|password|passwd|credential|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|ciphertext|(^|_)iv$)/i;

function parseDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function sanitizeBusinessKnowledgePayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return canonicalize(value) as Record<string, unknown>;
}

function displayKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(canonicalize(value));
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const rawLine of text.split('\n')) {
    const lines: string[] = [];
    if (rawLine.length <= maxChars) lines.push(rawLine);
    else
      for (let i = 0; i < rawLine.length; i += maxChars) lines.push(rawLine.slice(i, i + maxChars));
    for (const line of lines) {
      const candidate = current ? `${current}\n${line}` : line;
      if (current && candidate.length > maxChars) {
        chunks.push(current);
        current = line;
      } else current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function normalizeBusinessKnowledgeRecord(
  domain: BusinessKnowledgeDomainDefinition,
  input: BusinessKnowledgeRecord,
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedBusinessDocument {
  const payload = sanitizeBusinessKnowledgePayload(input.payload);
  const rawText = JSON.stringify(payload);
  const normalizedText = [
    `Domain: ${domain.name}`,
    `Record type: ${input.recordType}`,
    `Title: ${input.title}`,
    ...Object.entries(payload).map(([key, value]) => `${displayKey(key)}: ${displayValue(value)}`),
  ].join('\n');
  const occurredAt = input.occurredAt ?? input.sourceUpdatedAt ?? new Date(0);
  const sourceUpdatedAt = input.sourceUpdatedAt ?? input.occurredAt ?? new Date(0);
  const contextPrefix = `${domain.name}; ${input.recordType}; ${input.title}`;
  const chunks = splitText(normalizedText, maxChars).map((chunkText, seq) => ({
    chunkKey: `record:${String(seq).padStart(6, '0')}`,
    kind: 'raw' as const,
    seq,
    chunkText,
    contextPrefix,
    contentHash: knowledgeContentHash(`${contextPrefix}\n\n${chunkText}`),
    occurredAt,
    metadata: { domain: domain.key, recordType: input.recordType, externalId: input.externalId },
  }));
  const contentHash = knowledgeContentHash(normalizedText);
  return {
    externalId: input.externalId,
    title: input.title,
    rawText,
    normalizedText,
    contentHash,
    sourceRevision: contentHash,
    occurredAt,
    sourceUpdatedAt,
    metadata: { domain: domain.key, recordType: input.recordType },
    chunks,
  };
}

export function encodeBusinessKnowledgeCursor(cursor: BusinessKnowledgeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeBusinessKnowledgeCursor(
  value?: string | null,
): BusinessKnowledgeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof parsed.domain !== 'string' || !Number.isInteger(parsed.tableIndex)) return null;
    if (parsed.lastId !== null && typeof parsed.lastId !== 'string') return null;
    if (!BUSINESS_KNOWLEDGE_DOMAINS.some((domain) => domain.key === parsed.domain)) return null;
    return parsed as unknown as BusinessKnowledgeCursor;
  } catch {
    return null;
  }
}

function assertSqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`unsafe SQL identifier: ${value}`);
  return value;
}

export function requiredColumnsForBusinessTable(definition: BusinessTableDefinition): string[] {
  const expressions = [
    definition.idExpression ?? 'r.id::text',
    definition.cursorExpression ?? '',
    definition.titleExpression,
    definition.occurredAtExpression ?? '',
    definition.updatedAtExpression ?? '',
  ];
  const columns = new Set<string>([definition.orgColumn ?? 'org_id']);
  for (const field of BUSINESS_FIELD_ALLOWLISTS[definition.table] ?? []) columns.add(field);
  for (const expression of expressions) {
    for (const match of expression.matchAll(/\br\.([a-z][a-z0-9_]*)\b/g)) columns.add(match[1]);
  }
  return [...columns].sort();
}

/** Introspect the live production schema before an explicit full backfill. */
export async function validateBusinessKnowledgeSchema(
  ctx: CoreCtx,
  domainKeys?: BusinessKnowledgeDomainKey[],
): Promise<void> {
  const domains = domainKeys?.map(getBusinessKnowledgeDomain) ?? BUSINESS_KNOWLEDGE_DOMAINS;
  const definitions = domains.flatMap((domain) => domain.tables);
  const customRequirements = definitions.flatMap((definition) =>
    Object.entries(CUSTOM_QUERY_REQUIRED_COLUMNS[definition.table] ?? {}),
  );
  const tableNames = [
    ...new Set([
      ...definitions.map((definition) => definition.table),
      ...customRequirements.map(([table]) => table),
    ]),
  ];
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = any(${textArray(tableNames)})
  `),
  )) as unknown as Array<{ table_name: string; column_name: string }>;
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  const missing: string[] = [];
  for (const definition of definitions) {
    const actual = columnsByTable.get(definition.table);
    if (!actual) {
      missing.push(`${definition.table} (table)`);
      continue;
    }
    for (const column of requiredColumnsForBusinessTable(definition)) {
      if (!actual.has(column)) missing.push(`${definition.table}.${column}`);
    }
  }
  for (const [table, required] of customRequirements) {
    const actual = columnsByTable.get(table);
    if (!actual) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of required) if (!actual.has(column)) missing.push(`${table}.${column}`);
  }
  if (missing.length > 0) {
    throw new Error(`Business knowledge schema mismatch: ${missing.join(', ')}`);
  }
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function cursorPredicate(definition: BusinessTableDefinition, afterCursor?: string | null): string {
  if (!afterCursor) return '';
  const cursorExpression = definition.cursorExpression ?? definition.idExpression ?? 'r.id';
  return `and (${cursorExpression}) > ${sqlStringLiteral(afterCursor)}`;
}

/** Build one production-Postgres query for a single table/page. The predicate is
 * deliberately inside the source query so grouped telemetry does not aggregate
 * every historical row merely to discard earlier cursor keys outside it. */
export function businessTableQueryText(
  definition: BusinessTableDefinition,
  afterCursor?: string | null,
): string {
  const table = assertSqlIdentifier(definition.table);
  const custom = CUSTOM_BUSINESS_TABLE_QUERIES[table];
  if (custom)
    return custom.replace('/*__CURSOR_PREDICATE__*/', cursorPredicate(definition, afterCursor));
  const fields = BUSINESS_FIELD_ALLOWLISTS[table];
  if (!fields?.length) throw new Error(`Missing business corpus field allowlist for ${table}`);
  const recordType = definition.recordType ?? table;
  const orgColumn = definition.orgColumn ?? 'org_id';
  const idExpression = definition.idExpression ?? 'r.id::text';
  const cursorExpression = definition.cursorExpression ?? definition.idExpression ?? 'r.id';
  const occurredAt = definition.occurredAtExpression ?? 'null::timestamptz';
  const updatedAt = definition.updatedAtExpression ?? occurredAt;
  const fieldSql = fields.map((field) => `'${assertSqlIdentifier(field)}'`).join(', ');
  return `
    select '${table}:' || (${idExpression}) as external_id,
      (${cursorExpression}) as cursor_id,
      '${recordType}'::text as record_type,
      (${definition.titleExpression})::text as title,
      coalesce((
        select jsonb_object_agg(field.key, field.value)
        from jsonb_each(to_jsonb(r)) field
        where field.key = any(array[${fieldSql}]::text[])
      ), '{}'::jsonb) as payload,
      (${occurredAt})::timestamptz as occurred_at,
      (${updatedAt})::timestamptz as source_updated_at
    from ${table} r
    where r.${orgColumn}::text = current_setting('app.current_org_id', true)
      ${cursorPredicate(definition, afterCursor)}
  `;
}

function tableQuery(definition: BusinessTableDefinition, afterCursor?: string | null): SQL {
  return sql.raw(businessTableQueryText(definition, afterCursor));
}

/** Identity-only projection for terminal deletion reconciliation. Parent
 * aggregates never need to re-read or aggregate their child payloads here. */
export function businessTableIdentityQueryText(definition: BusinessTableDefinition): string {
  const table = assertSqlIdentifier(definition.table);
  const orgColumn = definition.orgColumn ?? 'org_id';
  if (table === 'meta_post_insights') {
    return `select distinct 'meta_post_insights:' || r.platform || ':' || r.post_id as external_id
      from meta_post_insights r
      where r.org_id = current_setting('app.current_org_id', true)`;
  }
  if (table === 'meta_ad_insights') {
    return `select distinct 'meta_ad_insights:' || r.ad_id || ':' || to_char(date_trunc('month', r.date), 'YYYY-MM') as external_id
      from meta_ad_insights r
      where r.org_id = current_setting('app.current_org_id', true)`;
  }
  const idExpression = definition.idExpression ?? 'r.id::text';
  return `select '${table}:' || (${idExpression}) as external_id
    from ${table} r
    where r.${orgColumn}::text = current_setting('app.current_org_id', true)`;
}

/** UNION is reserved for the one terminal deletion/count reconciliation pass;
 * normal pages query exactly one table and carry its own cursor. */
function deletionDomainQuery(domain: BusinessKnowledgeDomainDefinition): SQL {
  return sql.raw(
    domain.tables
      .map((definition) => businessTableIdentityQueryText(definition))
      .join('\nunion all\n'),
  );
}

export function getBusinessKnowledgeDomain(
  key: BusinessKnowledgeDomainKey,
): BusinessKnowledgeDomainDefinition {
  const domain = BUSINESS_KNOWLEDGE_DOMAINS.find((candidate) => candidate.key === key);
  if (!domain) throw new Error(`Unknown business knowledge domain: ${key}`);
  return domain;
}

function uuidArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::uuid[]`;
}

function textArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export function businessKnowledgeSourceConfig(domain: BusinessKnowledgeDomainDefinition) {
  const tables = new Set<string>();
  for (const definition of domain.tables) {
    tables.add(definition.table);
    for (const dependency of Object.keys(CUSTOM_QUERY_REQUIRED_COLUMNS[definition.table] ?? {})) {
      tables.add(dependency);
    }
  }
  return {
    domain: domain.key,
    requiredModule: domain.requiredModule,
    requiredFieldLevel: domain.requiredFieldLevel ?? 0,
    tables: [...tables],
    limitations: domain.limitations ?? [],
    exclusions: 'credentials, connector state, logs, audit blobs, derived indexes',
  };
}

/** Cheap discovery for page loads/new orgs. It never starts embedding work or
 * regresses an existing source's status; the durable reconcile job does that. */
export async function ensureBusinessKnowledgeSources(ctx: CoreCtx): Promise<KnowledgeSource[]> {
  await ensureMasterBrain(ctx);
  return withOrgCore(ctx, async (tx) => {
    await tx
      .insert(knowledgeSources)
      .values(
        BUSINESS_KNOWLEDGE_DOMAINS.map((domain) => ({
          orgId: ctx.tenantId,
          connector: BUSINESS_CONNECTOR,
          externalKey: domain.key,
          name: domain.name,
          config: businessKnowledgeSourceConfig(domain),
          status: 'discovered',
          syncMode: 'incremental',
          cadence: 'on-demand+daily-reconcile',
        })),
      )
      .onConflictDoUpdate({
        target: [knowledgeSources.orgId, knowledgeSources.connector, knowledgeSources.externalKey],
        set: {
          // Every row has a domain-specific name/config. A multi-row upsert
          // cannot reference the per-row object through Drizzle's `set`, so use
          // excluded values while deliberately leaving status/watermark alone.
          name: sql`excluded.name`,
          config: sql`excluded.config`,
          syncMode: sql`excluded.sync_mode`,
          cadence: sql`excluded.cadence`,
          updatedAt: sql`now()`,
        },
      });
    return tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.orgId, ctx.tenantId),
          eq(knowledgeSources.connector, BUSINESS_CONNECTOR),
        ),
      );
  });
}

export async function ensureBusinessKnowledgeSource(
  ctx: CoreCtx,
  domainKey: BusinessKnowledgeDomainKey,
): Promise<KnowledgeSource> {
  const domain = getBusinessKnowledgeDomain(domainKey);
  await ensureBusinessKnowledgeSources(ctx);
  return withOrgCore(ctx, async (tx) => {
    await tx
      .insert(knowledgeSources)
      .values({
        orgId: ctx.tenantId,
        connector: BUSINESS_CONNECTOR,
        externalKey: domain.key,
        name: domain.name,
        config: businessKnowledgeSourceConfig(domain),
        status: 'processing',
        syncMode: 'incremental',
        cadence: 'on-demand+daily-reconcile',
      })
      .onConflictDoUpdate({
        target: [knowledgeSources.orgId, knowledgeSources.connector, knowledgeSources.externalKey],
        set: {
          name: domain.name,
          config: businessKnowledgeSourceConfig(domain),
          status: 'processing',
          lastError: null,
          updatedAt: new Date(),
        },
      });
    const [source] = await tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.orgId, ctx.tenantId),
          eq(knowledgeSources.connector, BUSINESS_CONNECTOR),
          eq(knowledgeSources.externalKey, domain.key),
        ),
      )
      .limit(1);
    if (!source) throw new Error(`failed to ensure business source ${domain.key}`);
    return source;
  });
}

/** Persist a domain-local failure without poisoning the durable all-domain job. */
export async function recordBusinessKnowledgeDomainError(
  ctx: CoreCtx,
  domainKey: BusinessKnowledgeDomainKey,
  cause: unknown,
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update knowledge_sources
      set status = 'failed', last_error = ${message.slice(0, 1000)}, updated_at = now()
      where org_id = current_setting('app.current_org_id', true)
        and connector = ${BUSINESS_CONNECTOR}
        and external_key = ${domainKey}
    `),
  );
}

async function loadBusinessPage(
  tx: CoreTx,
  domain: BusinessKnowledgeDomainDefinition,
  cursor: BusinessKnowledgeCursor | null,
  limit: number,
): Promise<{
  records: BusinessKnowledgeRecord[];
  hasMore: boolean;
  nextCursor: BusinessKnowledgeCursor | null;
}> {
  const tableIndex = Math.max(0, cursor?.tableIndex ?? 0);
  const definition = domain.tables[tableIndex];
  if (!definition) return { records: [], hasMore: false, nextCursor: null };
  const rows = (await tx.execute(sql`
    select records.external_id, records.record_type, records.title, records.payload,
      records.occurred_at, records.source_updated_at, records.cursor_id
    from (${tableQuery(definition, cursor?.lastId)}) records
    order by records.cursor_id
    limit ${limit + 1}
  `)) as unknown as BusinessRecordRow[];
  const hasMoreInTable = rows.length > limit;
  const selected = rows.slice(0, limit);
  const nextCursor = nextBusinessKnowledgeCursor(
    domain,
    tableIndex,
    selected.at(-1)?.cursor_id ?? cursor?.lastId ?? null,
    hasMoreInTable,
  );
  return {
    hasMore: nextCursor !== null,
    nextCursor,
    records: selected.map((row) => ({
      externalId: row.external_id,
      recordType: row.record_type,
      title: row.title,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      occurredAt: parseDate(row.occurred_at),
      sourceUpdatedAt: parseDate(row.source_updated_at),
    })),
  };
}

export function nextBusinessKnowledgeCursor(
  domain: BusinessKnowledgeDomainDefinition,
  tableIndex: number,
  lastId: string | null,
  hasMoreInTable: boolean,
): BusinessKnowledgeCursor | null {
  if (hasMoreInTable) return { domain: domain.key, tableIndex, lastId };
  return tableIndex + 1 < domain.tables.length
    ? { domain: domain.key, tableIndex: tableIndex + 1, lastId: null }
    : null;
}

async function prepareBusinessDocuments(
  tx: CoreTx,
  sourceId: string,
  domain: BusinessKnowledgeDomainDefinition,
  records: BusinessKnowledgeRecord[],
): Promise<PreparedBusinessDocument[]> {
  if (records.length === 0) return [];
  const documents = records.map((record) => normalizeBusinessKnowledgeRecord(domain, record));
  const externalIds = documents.map((document) => document.externalId);
  const existing = (await tx.execute(sql`
    select id::text, external_id, content_hash
    from knowledge_documents
    where org_id = current_setting('app.current_org_id', true)
      and source_id = ${sourceId}::uuid
      and external_id = any(${textArray(externalIds)})
  `)) as unknown as ExistingDocumentRow[];
  const existingByExternalId = new Map(existing.map((row) => [row.external_id, row]));
  const documentIds = existing.map((row) => row.id);
  const oldChunks =
    documentIds.length === 0
      ? []
      : ((await tx.execute(sql`
    select document_id::text, chunk_key, content_hash, embedding_model,
      (embedding is not null) as has_embedding
    from knowledge_chunks
    where org_id = current_setting('app.current_org_id', true)
      and document_id = any(${uuidArray(documentIds)})
  `)) as unknown as ExistingChunkRow[]);
  const chunksByDocument = new Map<string, ExistingChunkRow[]>();
  for (const chunk of oldChunks) {
    const values = chunksByDocument.get(chunk.document_id) ?? [];
    values.push(chunk);
    chunksByDocument.set(chunk.document_id, values);
  }
  return documents.map((document) => {
    const previous = existingByExternalId.get(document.externalId);
    const documentId = previous?.id ?? randomUUID();
    const oldByKey = new Map(
      (chunksByDocument.get(documentId) ?? []).map((chunk) => [chunk.chunk_key, chunk]),
    );
    const changedChunkKeys = new Set(
      document.chunks
        .filter((chunk) => {
          const old = oldByKey.get(chunk.chunkKey);
          return (
            !old ||
            old.content_hash !== chunk.contentHash ||
            !old.has_embedding ||
            old.embedding_model !== KNOWLEDGE_EMBEDDING_MODEL
          );
        })
        .map((chunk) => chunk.chunkKey),
    );
    const nextKeys = new Set(document.chunks.map((chunk) => chunk.chunkKey));
    return {
      sourceId,
      documentId,
      document,
      changedDocument: !previous || previous.content_hash !== document.contentHash,
      changedChunkKeys,
      staleChunkKeys: [...oldByKey.keys()].filter((key) => !nextKeys.has(key)),
    };
  });
}

async function embedBusinessDocuments(
  prepared: PreparedBusinessDocument[],
): Promise<Map<string, number[]>> {
  const changed = prepared.flatMap((item) =>
    item.document.chunks
      .filter((chunk) => item.changedChunkKeys.has(chunk.chunkKey))
      .map((chunk) => ({
        key: `${item.documentId}\u0000${chunk.chunkKey}`,
        text: `${chunk.contextPrefix}\n\n${chunk.chunkText}`,
      })),
  );
  const vectors = new Map<string, number[]>();
  if (changed.length === 0 || !embeddingsEnabled()) return vectors;
  for (let i = 0; i < changed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = changed.slice(i, i + EMBEDDING_BATCH_SIZE);
    const embedded = await embedTexts(batch.map((item) => item.text));
    batch.forEach((item, index) => vectors.set(item.key, embedded[index]));
  }
  return vectors;
}

async function persistBusinessDocuments(
  ctx: CoreCtx,
  prepared: PreparedBusinessDocument[],
  vectors: Map<string, number[]>,
): Promise<number> {
  if (prepared.length === 0) return 0;
  return withOrgCore(ctx, async (tx) => {
    let deletedChunks = 0;
    for (const item of prepared) {
      if (
        !item.changedDocument &&
        item.changedChunkKeys.size === 0 &&
        item.staleChunkKeys.length === 0
      )
        continue;
      const document = item.document;
      const allChangedEmbedded = [...item.changedChunkKeys].every((key) =>
        vectors.has(`${item.documentId}\u0000${key}`),
      );
      const status = item.changedChunkKeys.size > 0 && !allChangedEmbedded ? 'pending' : 'ready';
      await tx.execute(sql`
        insert into knowledge_documents
          (id, org_id, source_id, external_id, title, raw_text, normalized_text,
           content_hash, source_revision, occurred_at, source_updated_at,
           ingested_at, status, metadata, updated_at)
        values (${item.documentId}::uuid, current_setting('app.current_org_id', true), ${item.sourceId}::uuid,
          ${document.externalId}, ${document.title}, ${document.rawText}, ${document.normalizedText},
          ${document.contentHash}, ${document.sourceRevision}, ${document.occurredAt.toISOString()}::timestamptz,
          ${document.sourceUpdatedAt.toISOString()}::timestamptz, now(), ${status},
          ${JSON.stringify(document.metadata)}::jsonb, now())
        on conflict (org_id, source_id, external_id) do update set
          title = excluded.title, raw_text = excluded.raw_text,
          normalized_text = excluded.normalized_text, content_hash = excluded.content_hash,
          source_revision = excluded.source_revision, occurred_at = excluded.occurred_at,
          source_updated_at = excluded.source_updated_at, ingested_at = excluded.ingested_at,
          status = excluded.status, metadata = excluded.metadata, updated_at = excluded.updated_at
      `);
      for (const chunk of document.chunks) {
        if (!item.changedChunkKeys.has(chunk.chunkKey)) continue;
        const vector = vectors.get(`${item.documentId}\u0000${chunk.chunkKey}`);
        const vectorSql = vector ? sql`${toVectorLiteral(vector)}::vector` : sql`null`;
        await tx.execute(sql`
          insert into knowledge_chunks
            (org_id, source_id, document_id, chunk_key, kind, seq, chunk_text,
             context_prefix, content_hash, embedding, embedding_model, occurred_at, metadata, updated_at)
          values (current_setting('app.current_org_id', true), ${item.sourceId}::uuid, ${item.documentId}::uuid,
            ${chunk.chunkKey}, ${chunk.kind}, ${chunk.seq}, ${chunk.chunkText}, ${chunk.contextPrefix},
            ${chunk.contentHash}, ${vectorSql}, ${vector ? KNOWLEDGE_EMBEDDING_MODEL : null},
            ${chunk.occurredAt.toISOString()}::timestamptz, ${JSON.stringify(chunk.metadata)}::jsonb, now())
          on conflict (org_id, document_id, chunk_key) do update set
            source_id = excluded.source_id, kind = excluded.kind, seq = excluded.seq,
            chunk_text = excluded.chunk_text, context_prefix = excluded.context_prefix,
            embedding = case when knowledge_chunks.content_hash = excluded.content_hash
              then coalesce(excluded.embedding, knowledge_chunks.embedding) else excluded.embedding end,
            embedding_model = case when knowledge_chunks.content_hash = excluded.content_hash
              then coalesce(excluded.embedding_model, knowledge_chunks.embedding_model) else excluded.embedding_model end,
            content_hash = excluded.content_hash, occurred_at = excluded.occurred_at,
            metadata = excluded.metadata, updated_at = excluded.updated_at
        `);
      }
      if (item.staleChunkKeys.length > 0) {
        const deleted = (await tx.execute(sql`
          delete from knowledge_chunks
          where org_id = current_setting('app.current_org_id', true)
            and document_id = ${item.documentId}::uuid
            and chunk_key = any(${textArray(item.staleChunkKeys)})
          returning id
        `)) as unknown as Array<{ id: string }>;
        deletedChunks += deleted.length;
      }
    }
    return deletedChunks;
  });
}

async function reconcileBusinessDeletions(
  ctx: CoreCtx,
  source: KnowledgeSource,
  domain: BusinessKnowledgeDomainDefinition,
): Promise<{ deletedDocuments: number; deletedChunks: number; expectedDocuments: number }> {
  return withOrgCore(ctx, async (tx) => {
    const [reconciled] = (await tx.execute(sql`
      with current_records as materialized (
        select records.external_id from (${deletionDomainQuery(domain)}) records
      ), tombstones as (
        update knowledge_documents document
        set status = 'deleted', ingested_at = now(), updated_at = now()
        where document.org_id = current_setting('app.current_org_id', true)
          and document.source_id = ${source.id}::uuid and document.status <> 'deleted'
          and not exists (
            select 1 from current_records current
            where current.external_id = document.external_id
          )
        returning document.id
      ), deleted_chunks as (
        delete from knowledge_chunks chunk
        using tombstones
        where chunk.org_id = current_setting('app.current_org_id', true)
          and chunk.document_id = tombstones.id
        returning chunk.id
      )
      select (select count(*)::int from current_records) as expected_documents,
        (select count(*)::int from tombstones) as deleted_documents,
        (select count(*)::int from deleted_chunks) as deleted_chunks
    `)) as unknown as Array<{
      expected_documents: number;
      deleted_documents: number;
      deleted_chunks: number;
    }>;
    const expectedDocuments = Number(reconciled?.expected_documents ?? 0);
    await tx.execute(sql`
      update knowledge_sources
      set watermark = jsonb_set(watermark, '{expectedDocuments}', to_jsonb(${expectedDocuments}::int), true),
        status = case when exists (
          select 1 from knowledge_chunks chunk
          where chunk.org_id = current_setting('app.current_org_id', true)
            and chunk.source_id = ${source.id}::uuid and chunk.embedding is null
        ) then 'queued' else 'ready' end,
        last_synced_at = now(), last_error = null, updated_at = now()
      where org_id = current_setting('app.current_org_id', true) and id = ${source.id}::uuid
    `);
    return {
      deletedDocuments: Number(reconciled?.deleted_documents ?? 0),
      deletedChunks: Number(reconciled?.deleted_chunks ?? 0),
      expectedDocuments,
    };
  });
}

export async function backfillBusinessKnowledgeDomain(
  ctx: CoreCtx,
  domainKey: BusinessKnowledgeDomainKey,
  opts?: { cursor?: string | null; limit?: number },
): Promise<BusinessBackfillResult> {
  const domain = getBusinessKnowledgeDomain(domainKey);
  const source = await ensureBusinessKnowledgeSource(ctx, domainKey);
  const decoded = decodeBusinessKnowledgeCursor(opts?.cursor);
  if (decoded && decoded.domain !== domainKey)
    throw new Error(`Cursor belongs to ${decoded.domain}, not ${domainKey}`);
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? DEFAULT_BATCH_SIZE)));
  try {
    const page = await withOrgCore(ctx, async (tx) => {
      const loaded = await loadBusinessPage(tx, domain, decoded, limit);
      return {
        ...loaded,
        prepared: await prepareBusinessDocuments(tx, source.id, domain, loaded.records),
      };
    });
    const vectors = await embedBusinessDocuments(page.prepared);
    const deletedChunks = await persistBusinessDocuments(ctx, page.prepared, vectors);
    const reconciled = page.hasMore
      ? { deletedDocuments: 0, deletedChunks: 0 }
      : await reconcileBusinessDeletions(ctx, source, domain);
    return {
      domain: domainKey,
      processed: page.prepared.length,
      changedDocuments: page.prepared.filter((item) => item.changedDocument).length,
      changedChunks: page.prepared.reduce((sum, item) => sum + item.changedChunkKeys.size, 0),
      embeddedChunks: vectors.size,
      unchangedChunks: page.prepared.reduce(
        (sum, item) => sum + item.document.chunks.length - item.changedChunkKeys.size,
        0,
      ),
      deletedDocuments: reconciled.deletedDocuments,
      deletedChunks: deletedChunks + reconciled.deletedChunks,
      nextCursor: page.nextCursor ? encodeBusinessKnowledgeCursor(page.nextCursor) : null,
      hasMore: page.hasMore,
    };
  } catch (cause) {
    await recordBusinessKnowledgeDomainError(ctx, domainKey, cause);
    throw cause;
  }
}

export async function reconcileAllBusinessKnowledge(
  ctx: CoreCtx,
  opts?: {
    limit?: number;
    domains?: BusinessKnowledgeDomainKey[];
    onPage?: (result: BusinessBackfillResult) => void;
  },
): Promise<BusinessBackfillResult[]> {
  const domains = opts?.domains ?? BUSINESS_KNOWLEDGE_DOMAINS.map((domain) => domain.key);
  await validateBusinessKnowledgeSchema(ctx, domains);
  const results: BusinessBackfillResult[] = [];
  for (const domain of domains) {
    let cursor: string | null = null;
    do {
      const result = await backfillBusinessKnowledgeDomain(ctx, domain, {
        cursor,
        limit: opts?.limit,
      });
      results.push(result);
      opts?.onPage?.(result);
      cursor = result.nextCursor;
    } while (cursor);
  }
  return results;
}
