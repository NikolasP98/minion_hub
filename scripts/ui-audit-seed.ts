import { writeFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUDIT_ORG_ID = '00000000-0000-4000-8000-000000000100';
const PASSWORD = process.env.E2E_UI_AUDIT_PASSWORD ?? 'MinionAudit!2026';
const FIXTURE_VERSION = 'ui-audit-v1';
const UUID = {
  brain: '00000000-0000-4000-8000-000000000201',
  contact: '00000000-0000-4000-8000-000000000202',
  invoice: '00000000-0000-4000-8000-000000000203',
  order: '00000000-0000-4000-8000-000000000204',
  ticket: '00000000-0000-4000-8000-000000000205',
  stockItem: '00000000-0000-4000-8000-000000000206',
  stockEntry: '00000000-0000-4000-8000-000000000207',
  metaConnection: '00000000-0000-4000-8000-000000000208',
  metaAsset: '00000000-0000-4000-8000-000000000209',
  metaPostInsight: '00000000-0000-4000-8000-000000000210',
  metaAdInsight: '00000000-0000-4000-8000-000000000211',
  scheduleLink: '00000000-0000-4000-8000-000000000212',
} as const;

const personas = [
  { id: 'owner', email: 'ui-audit-owner@minion.test', role: 'owner' },
  { id: 'manager', email: 'ui-audit-manager@minion.test', role: 'manager' },
  { id: 'member', email: 'ui-audit-member@minion.test', role: 'staff' },
  { id: 'restricted', email: 'ui-audit-restricted@minion.test', role: 'viewer' },
] as const;

function assertLocalSupabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'supabase']);
  if (!localHosts.has(url.hostname) && !url.hostname.endsWith('.local')) {
    throw new Error(
      `Refusing to seed non-local Supabase host ${url.hostname}. Start the local/CI Supabase stack; production and shared projects are never audit mutation targets.`,
    );
  }
}

async function must(label: string, operation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await operation;
  if (error) throw new Error(`${label}: ${error.message}`);
}

const REQUIRED_SCHEMA: ReadonlyArray<readonly [table: string, columns: string]> = [
  ['profiles', 'id,email,display_name,role,username'],
  ['organizations', 'id,name,slug'],
  ['organization_members', 'organization_id,profile_id,role'],
  ['member_roles', 'org_id,profile_id,role_key'],
  ['brains', 'id,org_id,name,description,visibility,created_by'],
  ['crm_contacts', 'id,org_id,human_id,display_name,owner_id,source'],
  [
    'fin_invoices',
    'id,org_id,provider,provider_ref,number,client_name,currency,total,status,issued_at',
  ],
  [
    'sales_orders',
    'id,org_id,human_id,customer_name,owner_id,description,quantity,total,currency,status',
  ],
  ['support_issues', 'id,org_id,human_id,subject,description,owner_id,status,priority,source'],
  ['flows', 'id,name,nodes,edges,user_id,tenant_id,created_at,updated_at,active,config'],
  ['built_skills', 'id,name,description,emoji,status,tenant_id,created_by'],
  ['built_agents', 'id,name,emoji,description,status,tenant_id,created_by'],
  ['built_tools', 'id,name,description,script_code,script_lang,status,tenant_id'],
  [
    'marketplace_agents',
    'id,name,role,category,tags,description,catchphrase,version,archetype,avatar_seed,github_path',
  ],
  ['stk_items', 'id,org_id,code,name,uom,is_stock_item,valuation_method'],
  ['stk_entries', 'id,org_id,human_id,type,status,note,created_by'],
  ['meta_connections', 'id,org_id,kind,fb_user_id,status,connected_by'],
  ['meta_assets', 'id,org_id,connection_id,kind,external_id,name,enabled'],
  [
    'meta_post_insights',
    'id,org_id,asset_id,platform,post_id,caption,media_type,posted_at,metric,value,period',
  ],
  [
    'meta_ad_insights',
    'id,org_id,ad_account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date,spend,impressions,reach,clicks,currency',
  ],
  ['sched_links', 'id,org_id,slug,title,description,event_type_ids,active'],
  ['join_link', 'token,organization_id,role,created_by,revoked,uses_count'],
];

/** Fail before creating identities when the disposable database is stale. */
async function assertRequiredSchema(admin: SupabaseClient): Promise<void> {
  const missing: string[] = [];
  for (const [table, columns] of REQUIRED_SCHEMA) {
    // PostgREST can answer a HEAD request without resolving the relation body,
    // which let a missing table slip past this preflight. Use a bounded GET so
    // both relation and column existence are checked before identities mutate.
    const { error } = await admin.from(table).select(columns).limit(1);
    if (error) missing.push(`${table} (${columns})`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Local Supabase is missing the UI-audit base schema: ${missing.join(', ')}. Restore/apply the complete Hub base schema before seeding; production fallback is forbidden.`,
    );
  }
}

async function findUser(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email === email);
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  throw new Error('Audit user scan exceeded 1,000 local users');
}

async function provisionPersona(
  admin: SupabaseClient,
  persona: (typeof personas)[number],
  reset: boolean,
) {
  let user = await findUser(admin, persona.email);
  if (user && reset) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    user = null;
  }
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: persona.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `UI Audit ${persona.id}` },
    });
    if (created.error || !created.data.user)
      throw created.error ?? new Error('User creation failed');
    user = created.data.user;
  } else {
    const updated = await admin.auth.admin.updateUserById(user.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `UI Audit ${persona.id}` },
    });
    if (updated.error) throw updated.error;
  }

  await must(
    `profile ${persona.id}`,
    admin.from('profiles').upsert(
      {
        id: user.id,
        email: persona.email,
        display_name: `UI Audit ${persona.id}`,
        role: 'user',
        username: `ui_audit_${persona.id}`,
      },
      { onConflict: 'id' },
    ),
  );
  await must(
    `organization membership ${persona.id}`,
    admin.from('organization_members').upsert(
      {
        organization_id: AUDIT_ORG_ID,
        profile_id: user.id,
        role: persona.role === 'owner' ? 'owner' : 'member',
      },
      { onConflict: 'organization_id,profile_id' },
    ),
  );
  await must(
    `role ${persona.id}`,
    admin
      .from('member_roles')
      .upsert(
        { org_id: AUDIT_ORG_ID, profile_id: user.id, role_key: persona.role },
        { onConflict: 'org_id,profile_id,role_key' },
      ),
  );
  return user.id;
}

async function seedCoreRows(admin: SupabaseClient, ownerId: string): Promise<void> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const rows: Array<{ table: string; conflict?: string; row: Record<string, unknown> }> = [
    {
      table: 'brains',
      row: {
        id: UUID.brain,
        org_id: AUDIT_ORG_ID,
        name: 'UI Audit Brain',
        description: 'Deterministic route-capture fixture',
        visibility: 'org',
        created_by: ownerId,
      },
    },
    {
      table: 'crm_contacts',
      row: {
        id: UUID.contact,
        org_id: AUDIT_ORG_ID,
        human_id: 'CONT-AUDIT-001',
        display_name: 'UI Audit Contact',
        owner_id: ownerId,
        source: 'manual',
      },
    },
    {
      table: 'fin_invoices',
      conflict: 'org_id,provider,provider_ref',
      row: {
        id: UUID.invoice,
        org_id: AUDIT_ORG_ID,
        provider: 'ui-audit',
        provider_ref: 'INV-AUDIT-001',
        number: 'INV-AUDIT-001',
        client_name: 'UI Audit Contact',
        currency: 'USD',
        total: '125.00',
        status: 'paid',
        issued_at: now,
      },
    },
    {
      table: 'sales_orders',
      row: {
        id: UUID.order,
        org_id: AUDIT_ORG_ID,
        human_id: 'SO-AUDIT-001',
        customer_name: 'UI Audit Contact',
        owner_id: ownerId,
        description: 'Deterministic audit order',
        quantity: '1',
        total: '125.00',
        currency: 'USD',
        status: 'confirmed',
      },
    },
    {
      table: 'support_issues',
      row: {
        id: UUID.ticket,
        org_id: AUDIT_ORG_ID,
        human_id: 'TKT-AUDIT-001',
        subject: 'Deterministic audit ticket',
        description: 'Route-capture fixture',
        owner_id: ownerId,
        status: 'open',
        priority: 'medium',
        source: 'manual',
      },
    },
    {
      table: 'flows',
      row: {
        id: 'ui-audit-flow',
        name: 'UI Audit Flow',
        nodes: '[]',
        edges: '[]',
        user_id: ownerId,
        tenant_id: AUDIT_ORG_ID,
        created_at: Date.now(),
        updated_at: Date.now(),
        active: false,
        config: '{}',
      },
    },
    {
      table: 'built_skills',
      row: {
        id: 'ui-audit-skill',
        name: 'UI Audit Skill',
        description: 'Deterministic audit skill',
        emoji: '🧪',
        status: 'published',
        tenant_id: AUDIT_ORG_ID,
        created_by: ownerId,
      },
    },
    {
      table: 'built_agents',
      row: {
        id: 'ui-audit-agent-draft',
        name: 'UI Audit Agent Draft',
        emoji: '🤖',
        description: 'Deterministic audit agent',
        status: 'draft',
        tenant_id: AUDIT_ORG_ID,
        created_by: ownerId,
      },
    },
    {
      table: 'built_tools',
      row: {
        id: 'ui-audit-tool',
        name: 'UI Audit Tool',
        description: 'Deterministic audit tool',
        script_code: 'console.log(JSON.stringify({ ok: true }))',
        script_lang: 'javascript',
        status: 'draft',
        tenant_id: AUDIT_ORG_ID,
        created_by: ownerId,
      },
    },
    {
      table: 'marketplace_agents',
      row: {
        id: 'ui-audit-marketplace-agent',
        name: 'UI Audit Marketplace Agent',
        role: 'Auditor',
        category: 'testing',
        tags: '["audit"]',
        description: 'Deterministic marketplace fixture',
        catchphrase: 'Inspect everything.',
        version: '1.0.0',
        archetype: 'copilot',
        avatar_seed: 'ui-audit',
        github_path: 'fixtures/ui-audit',
      },
    },
    {
      table: 'stk_items',
      conflict: 'org_id,code',
      row: {
        id: UUID.stockItem,
        org_id: AUDIT_ORG_ID,
        code: 'AUDIT-ITEM',
        name: 'UI Audit Item',
        uom: 'unit',
        is_stock_item: true,
        valuation_method: 'moving_avg',
      },
    },
    {
      table: 'stk_entries',
      row: {
        id: UUID.stockEntry,
        org_id: AUDIT_ORG_ID,
        human_id: 'STE-AUDIT-001',
        type: 'receipt',
        status: 'draft',
        note: 'Deterministic audit entry',
        created_by: ownerId,
      },
    },
    {
      table: 'meta_connections',
      row: {
        id: UUID.metaConnection,
        org_id: AUDIT_ORG_ID,
        kind: 'system_user',
        fb_user_id: 'ui-audit',
        status: 'active',
        connected_by: ownerId,
      },
    },
    {
      table: 'meta_assets',
      conflict: 'org_id,kind,external_id',
      row: {
        id: UUID.metaAsset,
        org_id: AUDIT_ORG_ID,
        connection_id: UUID.metaConnection,
        kind: 'page',
        external_id: 'ui-audit-page',
        name: 'UI Audit Page',
        enabled: true,
      },
    },
    {
      table: 'meta_post_insights',
      conflict: 'org_id,post_id,metric,period',
      row: {
        id: UUID.metaPostInsight,
        org_id: AUDIT_ORG_ID,
        asset_id: UUID.metaAsset,
        platform: 'fb',
        post_id: 'ui-audit-post',
        caption: 'Deterministic audit post',
        media_type: 'IMAGE',
        posted_at: now,
        metric: 'impressions',
        value: '100',
        period: 'lifetime',
      },
    },
    {
      table: 'meta_ad_insights',
      conflict: 'org_id,ad_id,date',
      row: {
        id: UUID.metaAdInsight,
        org_id: AUDIT_ORG_ID,
        ad_account_id: 'ui-audit-account',
        campaign_id: 'ui-audit-campaign',
        campaign_name: 'UI Audit Campaign',
        adset_id: 'ui-audit-adset',
        adset_name: 'UI Audit Ad Set',
        ad_id: 'ui-audit-ad',
        ad_name: 'UI Audit Ad',
        date: today,
        spend: '10',
        impressions: 100,
        reach: 90,
        clicks: 5,
        currency: 'USD',
      },
    },
    {
      table: 'sched_links',
      conflict: 'org_id,slug',
      row: {
        id: UUID.scheduleLink,
        org_id: AUDIT_ORG_ID,
        slug: 'ui-audit-booking',
        title: 'UI Audit Booking',
        description: 'Deterministic public booking fixture',
        event_type_ids: [],
        active: true,
      },
    },
    {
      table: 'join_link',
      conflict: 'token',
      row: {
        token: 'ui-audit-join',
        organization_id: AUDIT_ORG_ID,
        role: 'member',
        created_by: ownerId,
        revoked: false,
        uses_count: 0,
      },
    },
  ];

  for (const fixture of rows) {
    await must(
      `fixture table ${fixture.table}`,
      admin.from(fixture.table).upsert(fixture.row, { onConflict: fixture.conflict ?? 'id' }),
    );
  }
}

function dynamicFixtures() {
  const one = (fixtureId: string, pattern: string, key: string, value: string) => ({
    id: pattern.replace(/[^a-z0-9]+/gi, '-'),
    fixtureId,
    pattern,
    params: { [key]: value },
  });
  return [
    one('system-agent-detail', '/agents/autonomous/[id]', 'id', 'scheduling.reminders'),
    one('built-agent-detail', '/agents/builder/[id]', 'id', 'ui-audit-agent-draft'),
    one('workshop-save', '/agents/workshop/[id]', 'id', 'ui-audit-workshop'),
    one('brain-detail', '/brains/[id]', 'id', UUID.brain),
    one('plugin-channel-detail', '/channels/[id]', 'id', 'telegram'),
    one('crm-contact-detail', '/crm/[contactId]', 'contactId', UUID.contact),
    one('invoice-detail', '/finances/invoices/[id]', 'id', UUID.invoice),
    one('flow-detail', '/flow-editor/[id]', 'id', 'ui-audit-flow'),
    one('master-flow-detail', '/flow-editor/master/[id]', 'id', 'channel-message-reply'),
    one('builder-skill-detail', '/flow-editor/skills/[id]', 'id', 'ui-audit-skill'),
    one(
      'marketplace-agent-detail',
      '/marketplace/agents/[slug]',
      'slug',
      'ui-audit-marketplace-agent',
    ),
    one('plugin-detail', '/plugins/[id]', 'id', 'memory-core'),
    one('sales-order-detail', '/sales/[id]', 'id', UUID.order),
    one('session-debug', '/sessions/[sessionKey]/debug', 'sessionKey', 'ui-audit-session'),
    one(
      'social-campaign-detail',
      '/socials/campaigns/[campaignId]',
      'campaignId',
      'ui-audit-campaign',
    ),
    one('social-post-detail', '/socials/posts/[postId]', 'postId', 'ui-audit-post'),
    one('stock-entry-detail', '/stock/entries/[id]', 'id', UUID.stockEntry),
    one('stock-item-detail', '/stock/items/[id]', 'id', UUID.stockItem),
    one('support-ticket-detail', '/support/[id]', 'id', UUID.ticket),
    one('tool-detail', '/tools/[id]', 'id', 'ui-audit-tool'),
    one('workforce-agent-detail', '/workforce/agents/[id]', 'id', 'ui-audit-workforce-agent'),
    one('workforce-issue-detail', '/workforce/issues/[id]', 'id', 'ui-audit-workforce-issue'),
    one(
      'workforce-portfolio-detail',
      '/workforce/portfolios/[id]',
      'id',
      'ui-audit-workforce-portfolio',
    ),
    one('project-detail', '/workforce/projects/[id]', 'id', 'ui-audit-workforce-project'),
    one(
      'project-pipelines',
      '/workforce/projects/[id]/pipelines',
      'id',
      'ui-audit-workforce-project',
    ),
    one('public-booking-link', '/book/[slug]', 'slug', 'ui-audit-booking'),
    one(
      'channel-link-code',
      '/link/[code]',
      'code',
      'eyJjaCI6IndoYXRzYXBwIiwic2lkIjoidWktYXVkaXQtc2VuZGVyIiwiZXhwIjo0MTAyNDQ0ODAwMDAwfQ',
    ),
  ];
}

async function main() {
  const url = process.env.PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole)
    throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  assertLocalSupabase(url);
  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await assertRequiredSchema(admin);
  const reset = process.argv.includes('--reset');

  await must(
    'audit organization',
    admin
      .from('organizations')
      .upsert(
        { id: AUDIT_ORG_ID, name: 'Minion UI Audit', slug: 'minion-ui-audit' },
        { onConflict: 'id' },
      ),
  );
  const ids = new Map<string, string>();
  for (const persona of personas)
    ids.set(persona.id, await provisionPersona(admin, persona, reset));
  await seedCoreRows(admin, ids.get('owner')!);

  const fixtures = dynamicFixtures();
  const lines = [
    `E2E_UI_AUDIT_FIXTURE_VERSION=${FIXTURE_VERSION}`,
    `E2E_UI_AUDIT_FIXTURES='${JSON.stringify(fixtures)}'`,
    ...personas.flatMap((persona) => [
      `E2E_${persona.id.toUpperCase()}_EMAIL=${persona.email}`,
      `E2E_${persona.id.toUpperCase()}_PASSWORD=${PASSWORD}`,
    ]),
  ];
  await writeFile('.env.ui-audit.local', `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(
    `Provisioned ${personas.length} personas and ${fixtures.length} dynamic route fixtures in local org ${AUDIT_ORG_ID}.`,
  );
  console.log('Load .env.ui-audit.local before running bun run audit:ui:capture.');
}

await main();
