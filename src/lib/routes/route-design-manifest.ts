import type { CaptureFixtureId } from './capture-fixtures';
import { routeAccessPolicyIdForPattern, type RouteAccessPolicyId } from './route-access-policies';

export type RouteArchetype =
  | 'dashboard'
  | 'collection'
  | 'record-detail'
  | 'form-settings'
  | 'master-detail'
  | 'workspace-editor'
  | 'canvas-kanban'
  | 'terminal-remote-desktop'
  | 'public-auth';

export type RouteFamily =
  | 'organization'
  | 'agents-builders'
  | 'immersive-workspaces'
  | 'marketplace'
  | 'business-operations'
  | 'scheduling-pos'
  | 'socials'
  | 'stock'
  | 'platform-reliability'
  | 'workforce'
  | 'public-auth';

export type CaptureViewport = 'compact' | 'medium' | 'wide';
export type CapturePersonaId =
  'anonymous' | 'owner-admin' | 'manager-editor' | 'member-viewer' | 'restricted-no-module';

export type CaptureState =
  | 'populated'
  | 'default'
  | 'loading'
  | 'empty'
  | 'new'
  | 'validation-error'
  | 'saving'
  | 'saved'
  | 'submitting'
  | 'success'
  | 'complete'
  | 'not-found'
  | 'expired'
  | 'forbidden'
  | 'owner-filtered'
  | 'recoverable-error'
  | 'mutation-error'
  | 'destructive-confirm'
  | 'unavailable'
  | 'offline'
  | 'disconnected';

export interface ResponsiveTransformation {
  compact: string;
  medium: string;
  wide: string;
}

export type BreadcrumbRule =
  | { kind: 'none' }
  | { kind: 'path'; includeCurrent: boolean }
  | { kind: 'record'; param: string; fallback: string };

export interface RouteBaseMeta {
  id: string;
  pattern: string;
  family: RouteFamily;
  title: () => string;
  accessPolicyId: RouteAccessPolicyId;
  nav: 'primary' | 'section' | 'contextual' | 'hidden';
  breadcrumb: BreadcrumbRule;
}

export interface ScreenDesignMeta extends RouteBaseMeta {
  kind: 'screen';
  archetype: RouteArchetype;
  scroll: 'page' | 'region' | 'none';
  compact: ResponsiveTransformation;
  capture: {
    viewports: readonly CaptureViewport[];
    states: readonly CaptureState[];
    personas: readonly CapturePersonaId[];
    fixtureId: CaptureFixtureId | 'base-tenant';
    params?: Readonly<Record<string, string>>;
    query?: Readonly<Record<string, string>>;
  };
  figma: { page: string; framePrefix: string };
}

export interface RedirectDesignMeta extends RouteBaseMeta {
  kind: 'redirect';
  target: string;
  preserveQuery: boolean;
  preservePath?: boolean;
  status: 301 | 302 | 307 | 308;
  alternates?: readonly string[];
  capture?: never;
  figma?: never;
}

export type RouteDesignMeta = ScreenDesignMeta | RedirectDesignMeta;

const VIEWPORTS = ['compact', 'medium', 'wide'] as const;

const READ_ONLY_DETAIL_STATES = [
  'populated',
  'loading',
  'not-found',
  'forbidden',
] as const satisfies readonly CaptureState[];

const MUTATING_DETAIL_STATES = [
  ...READ_ONLY_DETAIL_STATES,
  'mutation-error',
] as const satisfies readonly CaptureState[];

const OWNER_MUTATING_DETAIL_STATES = [
  'populated',
  'loading',
  'not-found',
  'owner-filtered',
  'mutation-error',
  'forbidden',
] as const satisfies readonly CaptureState[];

const DESTRUCTIVE_DETAIL_STATES = [
  ...MUTATING_DETAIL_STATES,
  'destructive-confirm',
] as const satisfies readonly CaptureState[];

const OWNER_DESTRUCTIVE_DETAIL_STATES = [
  ...OWNER_MUTATING_DETAIL_STATES,
  'destructive-confirm',
] as const satisfies readonly CaptureState[];

const STATE_TEMPLATES: Readonly<Record<RouteArchetype, readonly CaptureState[]>> = {
  dashboard: ['populated', 'loading', 'empty', 'recoverable-error', 'unavailable', 'forbidden'],
  collection: ['populated', 'loading', 'empty', 'recoverable-error', 'forbidden'],
  'record-detail': READ_ONLY_DETAIL_STATES,
  'form-settings': [
    'default',
    'validation-error',
    'saving',
    'saved',
    'mutation-error',
    'forbidden',
  ],
  'master-detail': ['populated', 'loading', 'empty', 'not-found', 'recoverable-error', 'forbidden'],
  'workspace-editor': [
    'populated',
    'loading',
    'new',
    'offline',
    'unavailable',
    'recoverable-error',
  ],
  'canvas-kanban': ['populated', 'loading', 'new', 'disconnected', 'offline', 'recoverable-error'],
  'terminal-remote-desktop': [
    'populated',
    'loading',
    'offline',
    'unavailable',
    'recoverable-error',
  ],
  // Public pages vary substantially. Every public route supplies its own
  // applicable states below; this conservative fallback prevents invented
  // success/expired/not-found frames when a new route omits an override.
  'public-auth': ['default', 'recoverable-error'],
};

const RESPONSIVE: Readonly<Record<RouteArchetype, ResponsiveTransformation>> = {
  dashboard: {
    compact: 'Stack cards in task priority order; summaries precede secondary charts.',
    medium: 'Use a two-column card grid with page-owned scrolling.',
    wide: 'Expose the complete metric grid and secondary analysis regions.',
  },
  collection: {
    compact: 'Render priority columns or record cards; move bulk actions into overflow.',
    medium: 'Keep primary columns visible and allow the data region to scroll.',
    wide: 'Show the full table, filters and bulk-action toolbar.',
  },
  'record-detail': {
    compact: 'Stack side regions below the record and collapse actions into overflow.',
    medium: 'Use one main column with contextual panels below or in a sheet.',
    wide: 'Show the record and secondary context side-by-side where useful.',
  },
  'form-settings': {
    compact: 'Use one column; sticky save appears only when it cannot cover fields.',
    medium: 'Use one readable form column with local section navigation.',
    wide: 'Pair persistent section navigation with a bounded form column.',
  },
  'master-detail': {
    compact: 'Master and detail become separate route steps.',
    medium: 'Use a bounded master rail and a detail region.',
    wide: 'Keep master and detail visible with detail-region scrolling.',
  },
  'workspace-editor': {
    compact: 'Convert panes to tabs or a stack; inspectors open as sheets.',
    medium: 'Keep the task surface primary and move inspectors into a collapsible pane.',
    wide: 'Expose the complete multi-pane workspace with explicit pane scroll owners.',
  },
  'canvas-kanban': {
    compact: 'Preserve deliberate pan or horizontal scrolling; controls move to a sheet.',
    medium: 'Use a compact control rail over the internal canvas or board.',
    wide: 'Expose full controls while the canvas or board owns interaction and scroll.',
  },
  'terminal-remote-desktop': {
    compact: 'Use a full-screen task surface with compact connection controls.',
    medium: 'Use the complete viewport with a minimal status header.',
    wide: 'Use the full workspace and preserve the remote surface aspect contract.',
  },
  'public-auth': {
    compact: 'Center one task using dynamic viewport height and safe-area insets.',
    medium: 'Keep a bounded single-task surface with document scrolling.',
    wide: 'Center a focused panel with restrained supporting context.',
  },
};

const SCROLL_OWNER: Readonly<Record<RouteArchetype, 'page' | 'region' | 'none'>> = {
  dashboard: 'page',
  collection: 'region',
  'record-detail': 'page',
  'form-settings': 'page',
  'master-detail': 'region',
  'workspace-editor': 'region',
  'canvas-kanban': 'none',
  'terminal-remote-desktop': 'none',
  'public-auth': 'page',
};

export const FIGMA_PAGE_BY_FAMILY: Readonly<Record<RouteFamily, string>> = {
  organization: '10 Organization',
  'agents-builders': '20 Agents and builders',
  'immersive-workspaces': '50 Immersive workspaces',
  marketplace: '20 Agents and builders',
  'business-operations': '30 Business operations',
  'scheduling-pos': '30 Business operations',
  socials: '30 Business operations',
  stock: '30 Business operations',
  'platform-reliability': '40 Platform and reliability',
  workforce: '50 Immersive workspaces',
  'public-auth': '60 Public and auth',
};

function framePrefix(pattern: string): string {
  return pattern
    .replace(/^\//, '')
    .replace(/\[\.\.\.([^\]]+)\]/g, 'catchall-$1')
    .replace(/\[([^\]]+)\]/g, 'by-$1')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function defaultNav(pattern: string): RouteBaseMeta['nav'] {
  if (!pattern.startsWith('/')) return 'hidden';
  if (/\[[^\]]+\]/.test(pattern)) return 'contextual';
  const depth = pattern.split('/').filter(Boolean).length;
  return depth === 1 ? 'primary' : 'section';
}

function defaultBreadcrumb(pattern: string): BreadcrumbRule {
  const dynamic = pattern.match(/\[([^\]]+)\]/);
  if (dynamic && !dynamic[1].startsWith('...')) {
    return { kind: 'record', param: dynamic[1], fallback: 'Record' };
  }
  return pattern.split('/').filter(Boolean).length > 1
    ? { kind: 'path', includeCurrent: true }
    : { kind: 'none' };
}

function personasFor(policyId: RouteAccessPolicyId): readonly CapturePersonaId[] {
  if (policyId === 'public') return ['anonymous', 'member-viewer'];
  if (policyId === 'authenticated') return ['owner-admin', 'member-viewer'];
  if (
    policyId === 'role:admin' ||
    policyId.startsWith('capability:') ||
    policyId.startsWith('org-capability:')
  ) {
    return ['owner-admin', 'restricted-no-module'];
  }
  return ['owner-admin', 'manager-editor', 'restricted-no-module'];
}

interface ScreenOptions {
  fixtureId?: CaptureFixtureId;
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string>>;
  nav?: RouteBaseMeta['nav'];
  states?: readonly CaptureState[];
}

function screen(
  pattern: string,
  title: string,
  family: RouteFamily,
  archetype: RouteArchetype,
  options: ScreenOptions = {},
): ScreenDesignMeta {
  const accessPolicyId = routeAccessPolicyIdForPattern(pattern);
  return {
    id: `screen:${pattern}`,
    pattern,
    family,
    title: () => title,
    accessPolicyId,
    nav: options.nav ?? defaultNav(pattern),
    breadcrumb: defaultBreadcrumb(pattern),
    kind: 'screen',
    archetype,
    scroll: SCROLL_OWNER[archetype],
    compact: RESPONSIVE[archetype],
    capture: {
      viewports: VIEWPORTS,
      states: options.states ?? STATE_TEMPLATES[archetype],
      personas: personasFor(accessPolicyId),
      fixtureId: options.fixtureId ?? 'base-tenant',
      params: options.params,
      query: options.query,
    },
    figma: { page: FIGMA_PAGE_BY_FAMILY[family], framePrefix: framePrefix(pattern) },
  };
}

function redirectRoute(
  pattern: string,
  title: string,
  family: RouteFamily,
  target: string,
  status: RedirectDesignMeta['status'],
  options: Pick<RedirectDesignMeta, 'preserveQuery' | 'preservePath' | 'alternates'>,
): RedirectDesignMeta {
  return {
    id: `redirect:${pattern}`,
    pattern,
    family,
    title: () => title,
    accessPolicyId: routeAccessPolicyIdForPattern(pattern),
    nav: 'hidden',
    breadcrumb: { kind: 'none' },
    kind: 'redirect',
    target,
    status,
    ...options,
  };
}

export const ROUTE_DESIGN_MANIFEST: readonly RouteDesignMeta[] = [
  // Organization, identity and settings (19)
  screen('/account', 'Account', 'organization', 'form-settings'),
  screen('/account/connections', 'Connections', 'organization', 'form-settings'),
  screen('/account/security', 'Security', 'organization', 'form-settings'),
  screen('/memberships', 'Memberships', 'organization', 'collection'),
  screen('/orgs', 'Organizations', 'organization', 'collection'),
  screen('/team', 'Team', 'organization', 'collection'),
  screen('/users', 'Users', 'organization', 'collection'),
  screen('/users/join-requests', 'Join requests', 'organization', 'collection'),
  screen('/settings', 'Settings', 'organization', 'form-settings'),
  screen('/settings/appearance', 'Appearance', 'organization', 'form-settings'),
  screen('/settings/backups', 'Backups', 'organization', 'form-settings'),
  screen('/settings/gateways', 'Gateways', 'organization', 'form-settings'),
  screen('/settings/modules', 'Modules', 'organization', 'form-settings'),
  screen('/settings/notifications', 'Notification settings', 'organization', 'form-settings'),
  screen('/settings/plugins', 'Plugin settings', 'organization', 'form-settings'),
  screen('/settings/provision', 'Provisioning', 'organization', 'form-settings'),
  screen('/settings/roles', 'Roles', 'organization', 'form-settings'),
  screen('/settings/team', 'Team settings', 'organization', 'form-settings'),
  screen('/settings/workflows', 'Workflow settings', 'organization', 'form-settings'),

  // Agents, brains, builders, prompts and capabilities (21)
  screen('/agents', 'Agents', 'agents-builders', 'master-detail'),
  screen('/agents/autonomous', 'Autonomous agents', 'immersive-workspaces', 'collection'),
  screen('/agents/autonomous/[id]', 'Autonomous agent', 'immersive-workspaces', 'record-detail', {
    fixtureId: 'system-agent-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/agents/builder', 'Agent builder', 'agents-builders', 'collection'),
  screen('/agents/builder/[id]', 'Agent draft', 'agents-builders', 'workspace-editor', {
    fixtureId: 'built-agent-detail',
  }),
  screen('/agents/workshop', 'Agent workshop', 'immersive-workspaces', 'canvas-kanban'),
  screen('/agents/workshop/[id]', 'Workshop save', 'immersive-workspaces', 'canvas-kanban', {
    fixtureId: 'workshop-save',
  }),
  screen('/agents/workshop/compare', 'Compare agents', 'immersive-workspaces', 'workspace-editor'),
  screen('/agents/workshop/groupchat', 'Group chat', 'immersive-workspaces', 'workspace-editor'),
  screen('/agents/workshop/leaderboard', 'Agent leaderboard', 'immersive-workspaces', 'collection'),
  screen('/brains', 'Brains', 'agents-builders', 'collection'),
  screen('/brains/[id]', 'Brain', 'agents-builders', 'record-detail', {
    fixtureId: 'brain-detail',
    states: DESTRUCTIVE_DETAIL_STATES,
  }),
  screen('/brains/agents', 'Brain agents', 'agents-builders', 'collection'),
  screen('/brains/template', 'Brain template', 'agents-builders', 'form-settings'),
  screen('/capabilities', 'Capabilities', 'agents-builders', 'collection'),
  screen('/flow-editor', 'Flow editor', 'agents-builders', 'collection'),
  screen('/flow-editor/[id]', 'Flow', 'agents-builders', 'canvas-kanban', {
    fixtureId: 'flow-detail',
  }),
  screen('/flow-editor/master/[id]', 'Master flow', 'agents-builders', 'canvas-kanban', {
    fixtureId: 'master-flow-detail',
  }),
  screen('/flow-editor/skills/[id]', 'Skill flow', 'agents-builders', 'workspace-editor', {
    fixtureId: 'builder-skill-detail',
  }),
  screen('/prompt', 'Prompt builder', 'agents-builders', 'workspace-editor'),
  screen('/tools/[id]', 'Tool', 'agents-builders', 'workspace-editor', {
    fixtureId: 'tool-detail',
    states: MUTATING_DETAIL_STATES,
  }),

  // Marketplace and plugins (8)
  screen('/marketplace', 'Marketplace', 'marketplace', 'dashboard'),
  screen('/marketplace/agents', 'Marketplace agents', 'marketplace', 'collection'),
  screen('/marketplace/agents/[slug]', 'Marketplace agent', 'marketplace', 'record-detail', {
    fixtureId: 'marketplace-agent-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/marketplace/hooks', 'Hooks', 'marketplace', 'collection'),
  screen('/marketplace/mcp-servers', 'MCP servers', 'marketplace', 'collection'),
  screen('/marketplace/plugins', 'Marketplace plugins', 'marketplace', 'collection'),
  screen('/marketplace/tools', 'Marketplace tools', 'marketplace', 'collection'),
  screen('/plugins/[id]', 'Plugin', 'marketplace', 'record-detail', {
    fixtureId: 'plugin-detail',
    states: MUTATING_DETAIL_STATES,
  }),

  // CRM, finance, sales, support and work (15)
  screen('/crm', 'CRM', 'business-operations', 'dashboard'),
  screen('/crm/[contactId]', 'Contact', 'business-operations', 'record-detail', {
    fixtureId: 'crm-contact-detail',
    states: OWNER_DESTRUCTIVE_DETAIL_STATES,
  }),
  screen('/crm/customers', 'Customers', 'business-operations', 'collection'),
  screen('/crm/insights', 'CRM insights', 'business-operations', 'dashboard'),
  screen('/crm/settings', 'CRM settings', 'business-operations', 'form-settings'),
  screen('/finances', 'Finances', 'business-operations', 'dashboard'),
  screen('/finances/invoices', 'Invoices', 'business-operations', 'collection'),
  screen('/finances/invoices/[id]', 'Invoice', 'business-operations', 'record-detail', {
    fixtureId: 'invoice-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/finances/products', 'Products', 'business-operations', 'collection'),
  screen('/finances/settings', 'Finance settings', 'business-operations', 'form-settings'),
  screen('/sales', 'Sales', 'business-operations', 'collection'),
  screen('/sales/[id]', 'Sales order', 'business-operations', 'record-detail', {
    fixtureId: 'sales-order-detail',
    states: OWNER_MUTATING_DETAIL_STATES,
  }),
  screen('/support', 'Support', 'business-operations', 'collection'),
  screen('/support/[id]', 'Support ticket', 'business-operations', 'record-detail', {
    fixtureId: 'support-ticket-detail',
    states: OWNER_MUTATING_DETAIL_STATES,
  }),
  screen('/work', 'My work', 'business-operations', 'dashboard'),

  // Scheduling and POS (12)
  screen('/scheduling', 'Scheduling', 'scheduling-pos', 'dashboard'),
  screen('/scheduling/bookings', 'Bookings', 'scheduling-pos', 'collection'),
  screen('/scheduling/calendar', 'Calendar', 'scheduling-pos', 'workspace-editor'),
  screen('/scheduling/event-types', 'Event types', 'scheduling-pos', 'collection'),
  screen('/scheduling/links', 'Booking links', 'scheduling-pos', 'collection'),
  screen('/scheduling/reminders', 'Reminders', 'scheduling-pos', 'collection'),
  screen('/scheduling/resources', 'Resources', 'scheduling-pos', 'collection'),
  screen('/scheduling/settings', 'Scheduling settings', 'scheduling-pos', 'form-settings'),
  screen('/pos/appointments', 'POS appointments', 'scheduling-pos', 'workspace-editor'),
  screen('/pos/catalog', 'POS catalog', 'scheduling-pos', 'collection'),
  screen('/pos/refills', 'POS refills', 'scheduling-pos', 'collection'),
  screen('/pos/sell', 'Point of sale', 'scheduling-pos', 'workspace-editor'),

  // Socials (6)
  screen('/socials', 'Socials', 'socials', 'dashboard'),
  screen('/socials/campaigns', 'Campaigns', 'socials', 'collection'),
  screen('/socials/campaigns/[campaignId]', 'Campaign', 'socials', 'record-detail', {
    fixtureId: 'social-campaign-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/socials/posts', 'Posts', 'socials', 'collection'),
  screen('/socials/posts/[postId]', 'Post', 'socials', 'record-detail', {
    fixtureId: 'social-post-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/socials/settings', 'Social settings', 'socials', 'form-settings'),

  // Stock (10)
  screen('/stock', 'Stock', 'stock', 'dashboard'),
  screen('/stock/commitments', 'Stock commitments', 'stock', 'collection'),
  screen('/stock/consume', 'Consume stock', 'stock', 'form-settings'),
  screen('/stock/consumption', 'Consumption', 'stock', 'collection'),
  screen('/stock/entries', 'Stock entries', 'stock', 'collection'),
  screen('/stock/entries/[id]', 'Stock entry', 'stock', 'record-detail', {
    fixtureId: 'stock-entry-detail',
    states: DESTRUCTIVE_DETAIL_STATES,
  }),
  screen('/stock/entries/new', 'New stock entry', 'stock', 'form-settings'),
  screen('/stock/items', 'Stock items', 'stock', 'collection'),
  screen('/stock/items/[id]', 'Stock item', 'stock', 'record-detail', {
    fixtureId: 'stock-item-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/stock/warehouses', 'Warehouses', 'stock', 'collection'),

  // Platform, sessions, reliability and remote work (15)
  screen('/home', 'Home', 'immersive-workspaces', 'dashboard'),
  screen('/home/settings', 'Home settings', 'immersive-workspaces', 'form-settings'),
  screen('/channels', 'Channels', 'platform-reliability', 'collection'),
  screen('/channels/[id]', 'Channel', 'platform-reliability', 'record-detail', {
    fixtureId: 'plugin-channel-detail',
    states: MUTATING_DETAIL_STATES,
  }),
  screen('/channels/gmail', 'Gmail channel', 'platform-reliability', 'form-settings'),
  screen('/config', 'Gateway configuration', 'platform-reliability', 'workspace-editor'),
  screen('/killswitches', 'Kill switches', 'platform-reliability', 'collection'),
  screen('/notifications', 'Notifications', 'platform-reliability', 'collection'),
  screen('/overview', 'Organization overview', 'platform-reliability', 'canvas-kanban'),
  screen('/reliability', 'Reliability', 'platform-reliability', 'dashboard'),
  screen('/sessions', 'Sessions', 'platform-reliability', 'workspace-editor'),
  screen(
    '/sessions/[sessionKey]/debug',
    'Session debug',
    'platform-reliability',
    'workspace-editor',
    {
      fixtureId: 'session-debug',
    },
  ),
  screen('/shells', 'Shells', 'platform-reliability', 'collection'),
  screen('/shells/[shellId]', 'Shell', 'platform-reliability', 'record-detail', {
    fixtureId: 'shell-detail',
    states: DESTRUCTIVE_DETAIL_STATES,
  }),
  screen('/terminal', 'Terminal', 'immersive-workspaces', 'terminal-remote-desktop'),

  // Workforce (19)
  screen('/workforce', 'Workforce', 'workforce', 'dashboard'),
  screen('/workforce/activity', 'Workforce activity', 'workforce', 'collection'),
  screen('/workforce/agents/[id]', 'Workforce agent', 'workforce', 'record-detail', {
    fixtureId: 'workforce-agent-detail',
    states: READ_ONLY_DETAIL_STATES,
  }),
  screen('/workforce/approvals', 'Approvals', 'workforce', 'collection'),
  screen('/workforce/costs', 'Workforce costs', 'workforce', 'dashboard'),
  screen('/workforce/goals', 'Goals', 'workforce', 'collection'),
  screen('/workforce/inbox', 'Inbox', 'workforce', 'collection'),
  screen('/workforce/issues', 'Issues', 'workforce', 'collection'),
  screen('/workforce/issues/[id]', 'Issue', 'workforce', 'record-detail', {
    fixtureId: 'workforce-issue-detail',
    states: READ_ONLY_DETAIL_STATES,
  }),
  screen('/workforce/org', 'Workforce organization', 'workforce', 'canvas-kanban'),
  screen('/workforce/portfolios', 'Portfolios', 'workforce', 'collection'),
  screen('/workforce/portfolios/[id]', 'Portfolio', 'workforce', 'record-detail', {
    fixtureId: 'workforce-portfolio-detail',
    states: READ_ONLY_DETAIL_STATES,
  }),
  screen('/workforce/projects', 'Projects', 'workforce', 'collection'),
  screen('/workforce/projects/[id]', 'Project', 'workforce', 'record-detail', {
    fixtureId: 'project-detail',
    states: READ_ONLY_DETAIL_STATES,
  }),
  screen(
    '/workforce/projects/[id]/pipelines',
    'Project pipelines',
    'workforce',
    'workspace-editor',
    {
      fixtureId: 'project-pipelines',
    },
  ),
  screen('/workforce/reliability', 'Workforce reliability', 'workforce', 'dashboard'),
  screen('/workforce/settings', 'Workforce settings', 'workforce', 'form-settings'),
  screen('/workforce/settings/agents', 'Workforce agent settings', 'workforce', 'form-settings'),
  screen('/workforce/welcome', 'Welcome to Workforce', 'workforce', 'public-auth', {
    states: ['default', 'submitting', 'complete', 'recoverable-error'],
  }),

  // Public, auth, joining and onboarding (10)
  screen('/auth/reset', 'Reset password', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: [
      'default',
      'validation-error',
      'submitting',
      'success',
      'expired',
      'recoverable-error',
    ],
  }),
  screen('/book/[slug]', 'Book', 'public-auth', 'public-auth', {
    fixtureId: 'public-booking-link',
    nav: 'hidden',
    states: [
      'default',
      'loading',
      'empty',
      'submitting',
      'success',
      'not-found',
      'recoverable-error',
    ],
  }),
  screen('/invite/accept', 'Accept invitation', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['default'],
  }),
  screen('/join', 'Join an organization', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['default', 'validation-error', 'submitting', 'recoverable-error'],
  }),
  screen('/join/sent', 'Join request sent', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['complete'],
  }),
  screen('/link/[code]', 'Link channel', 'public-auth', 'public-auth', {
    fixtureId: 'channel-link-code',
    nav: 'hidden',
    states: ['default', 'submitting', 'success', 'expired', 'recoverable-error'],
  }),
  screen('/login', 'Sign in', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['default', 'validation-error', 'submitting', 'recoverable-error'],
  }),
  screen('/login/forgot', 'Forgot password', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['default', 'validation-error', 'submitting', 'success'],
  }),
  screen('/onboarding', 'Onboarding', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['default', 'validation-error', 'submitting', 'recoverable-error'],
  }),
  screen('/onboarding/complete', 'Onboarding complete', 'public-auth', 'public-auth', {
    nav: 'hidden',
    states: ['complete'],
  }),

  // Redirect/proxy compatibility routes (7; intentionally no capture/Figma metadata)
  redirectRoute('/ads', 'Legacy Ads', 'socials', '/socials', 301, {
    preserveQuery: true,
  }),
  redirectRoute('/ads/[...path]', 'Legacy Ads path', 'socials', '/socials', 301, {
    preserveQuery: true,
    preservePath: true,
  }),
  redirectRoute('/builder', 'Legacy builder', 'agents-builders', '/agents/builder', 308, {
    preserveQuery: false,
  }),
  redirectRoute(
    '/crm/cleanup',
    'Legacy CRM cleanup',
    'business-operations',
    '/crm/settings?tab=hygiene',
    308,
    {
      preserveQuery: false,
    },
  ),
  redirectRoute('/pos', 'Point of sale entry', 'scheduling-pos', '/pos/sell', 302, {
    preserveQuery: false,
    alternates: ['/pos/appointments', '/pos/catalog', '/pos/refills'],
  }),
  redirectRoute('/tools', 'Tools', 'agents-builders', '/capabilities?tab=tools', 307, {
    preserveQuery: false,
  }),
  redirectRoute(
    '/workshop/[...path]',
    'Legacy workshop path',
    'agents-builders',
    '/agents/workshop',
    308,
    {
      preserveQuery: false,
      preservePath: true,
    },
  ),
] as const;

export const SCREEN_DESIGN_MANIFEST = ROUTE_DESIGN_MANIFEST.filter(
  (route): route is ScreenDesignMeta => route.kind === 'screen',
);

export const REDIRECT_DESIGN_MANIFEST = ROUTE_DESIGN_MANIFEST.filter(
  (route): route is RedirectDesignMeta => route.kind === 'redirect',
);

export const ROUTE_DESIGN_BY_PATTERN = new Map(
  ROUTE_DESIGN_MANIFEST.map((route) => [route.pattern, route] as const),
);

export function routeDesignMeta(pattern: string): RouteDesignMeta | undefined {
  return ROUTE_DESIGN_BY_PATTERN.get(pattern);
}
