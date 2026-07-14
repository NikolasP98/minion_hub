export interface FixtureResolution {
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string>>;
}

export interface FixtureContext {
  /** Stable namespace used by a capture run (for example `ui-audit-v1`). */
  namespace: string;
  provisionFixture?: (fixture: CaptureFixtureDefinition) => Promise<FixtureResolution | void>;
  resetFixture?: (fixture: CaptureFixtureDefinition) => Promise<void>;
}

export interface CaptureFixtureDefinition extends FixtureResolution {
  id: string;
  description: string;
}

export interface CaptureFixture extends CaptureFixtureDefinition {
  provision(context: FixtureContext): Promise<FixtureResolution>;
  reset(context: FixtureContext): Promise<void>;
}

function fixture(definition: CaptureFixtureDefinition): CaptureFixture {
  return {
    ...definition,
    async provision(context) {
      const provisioned = await context.provisionFixture?.(definition);
      return provisioned ?? { params: definition.params, query: definition.query };
    },
    async reset(context) {
      await context.resetFixture?.(definition);
    },
  };
}

const definitions = [
  {
    id: 'system-agent-detail',
    params: { id: 'audit-system-agent' },
    description: 'Visible system VM with health, artifact and admin-denial states.',
  },
  {
    id: 'built-agent-detail',
    params: { id: 'audit-built-agent' },
    description: 'Draft Hub agent with ordered skills and publish state.',
  },
  {
    id: 'workshop-save',
    params: { id: 'audit-workshop-save' },
    description: 'Persisted workshop graph, positions, links and conversation state.',
  },
  {
    id: 'brain-detail',
    params: { id: 'audit-brain' },
    description: 'Brain with documents, timeline, access records and owner variants.',
  },
  {
    id: 'plugin-channel-detail',
    params: { id: 'audit-channel' },
    description: 'Installed channel plugin control-center record.',
  },
  {
    id: 'crm-contact-detail',
    params: { contactId: 'audit-contact' },
    description: 'Owned CRM contact with PII, tags, score and activity timeline.',
  },
  {
    id: 'invoice-detail',
    params: { id: 'audit-invoice' },
    description: 'Invoice with lines, payments, CRM link and stock preview.',
  },
  {
    id: 'flow-detail',
    params: { id: 'audit-flow' },
    description: 'Persisted editable flow with nodes, edges and schedule metadata.',
  },
  {
    id: 'master-flow-detail',
    params: { id: 'personal-assistant' },
    description: 'Valid static master-flow identifier plus invalid-ID state.',
  },
  {
    id: 'builder-skill-detail',
    params: { id: 'audit-builder-skill' },
    description: 'Builder skill chapter graph and fake-gateway tools.',
  },
  {
    id: 'marketplace-agent-detail',
    params: { slug: 'audit-marketplace-agent' },
    description: 'Stable marketplace catalog agent with documents and assets.',
  },
  {
    id: 'plugin-detail',
    params: { id: 'audit-plugin' },
    description: 'Installed plugin control-center record.',
  },
  {
    id: 'sales-order-detail',
    params: { id: 'audit-sales-order' },
    description: 'Owned order with timeline and workflow transitions.',
  },
  {
    id: 'session-debug',
    params: { sessionKey: 'audit-session' },
    description: 'Gateway debug session with events, paused step and timeout state.',
  },
  {
    id: 'social-campaign-detail',
    params: { campaignId: 'audit-campaign' },
    description: 'Campaign with reporting rows, thumbnail and stable date range.',
  },
  {
    id: 'social-post-detail',
    params: { postId: 'audit-post' },
    description: 'Social post with comments, insights and media.',
  },
  {
    id: 'stock-entry-detail',
    params: { id: 'audit-stock-entry' },
    description: 'Draft/submitted stock entry with lines, parties and warehouses.',
  },
  {
    id: 'stock-item-detail',
    params: { id: 'audit-stock-item' },
    description: 'Stock item with bins, ledger, consumption and adjacent IDs.',
  },
  {
    id: 'support-ticket-detail',
    params: { id: 'audit-support-ticket' },
    description: 'Owned support ticket with SLA, timeline and workflow transitions.',
  },
  {
    id: 'tool-detail',
    params: { id: 'audit-gateway-tool' },
    query: { fixtureVariant: 'gateway' },
    description: 'Gateway tool; harness also provisions the Hub-builder variant.',
  },
  {
    id: 'workforce-agent-detail',
    params: { id: 'audit-workforce-agent' },
    description: 'Paperclip agent with harness and revision data.',
  },
  {
    id: 'workforce-issue-detail',
    params: { id: 'audit-workforce-issue' },
    description: 'Issue with approvals, evaluation, pipeline and viewer role keys.',
  },
  {
    id: 'workforce-portfolio-detail',
    params: { id: 'audit-workforce-portfolio' },
    description: 'Portfolio with projects, rollups and named lead agent.',
  },
  {
    id: 'project-detail',
    params: { id: 'audit-project' },
    description: 'Project with tasks, milestones, timesheets and Workforce link.',
  },
  {
    id: 'project-pipelines',
    params: { id: 'audit-project' },
    description: 'Workforce-linked project pipelines, steps and assigned agents.',
  },
  {
    id: 'public-booking-link',
    params: { slug: 'audit-booking-link' },
    description: 'Public booking link with slots, no-slot and confirmation variants.',
  },
  {
    id: 'channel-link-code',
    params: { code: 'audit-channel-link-code' },
    description: 'Future-expiry channel/user payload plus invalid and expired variants.',
  },
] as const satisfies readonly CaptureFixtureDefinition[];

export type CaptureFixtureId = (typeof definitions)[number]['id'];

export const CAPTURE_FIXTURES: Readonly<Record<CaptureFixtureId, CaptureFixture>> =
  Object.fromEntries(
    definitions.map((definition) => [definition.id, fixture(definition)]),
  ) as Record<CaptureFixtureId, CaptureFixture>;

export const CAPTURE_FIXTURE_IDS = Object.freeze(
  definitions.map((definition) => definition.id),
) as readonly CaptureFixtureId[];

export function getCaptureFixture(id: CaptureFixtureId): CaptureFixture {
  return CAPTURE_FIXTURES[id];
}
