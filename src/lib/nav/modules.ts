/**
 * Module registry for the ERPNext-style module switcher.
 *
 * A "module" is one business area the sidebar can scope itself to: picking it
 * replaces the full section list with just that module's pages. This is the
 * whole nav surface for roles that don't need the platform-wide view (staff,
 * viewer), while admins/managers keep the full sidebar by default.
 *
 * This registry is also the single source of truth for each module's SECTION
 * nav (CrmNav/AdsNav/SchedulingNav/StockNav/PosNav all map `getAreaItems`), so
 * the sidebar's module view and the section side-menu can never drift.
 *
 * Labels are paraglide calls, so build the list inside a `$derived` (like
 * `getNavSections`) to stay locale-reactive.
 */
import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Bot,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Cloud,
  CalendarDays,
  FileText,
  FolderKanban,
  Image,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  Link2,
  MailOpen,
  Megaphone,
  MessagesSquare,
  Network,
  Package,
  Power,
  Receipt,
  RefreshCw,
  Settings,
  Settings2,
  ShoppingCart,
  Sparkles,
  Store,
  Target,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  Building2,
} from 'lucide-svelte';
import { canonicalPath } from '$lib/canonical-path';
import { getSections } from '$lib/components/layout/sections';
import { resolvePluginIcon } from '$lib/plugins/icon-map';
import type { LucideIcon } from '$lib/nav/routes';
import * as m from '$lib/paraglide/messages';

export type ModuleNavItem = {
  id: string;
  href: string;
  label: string;
  /** lucide component, or a plugin icon name resolved by `NavIcon`. */
  icon: LucideIcon | string;
  /** Active-state matcher on the canonical path. */
  matcher: (path: string) => boolean;
  /** Query-aware override (agent archetype rosters live at /agents?…). */
  activeWhen?: (url: URL) => boolean;
  /** Nested one level under the preceding item (CRM insights). */
  indent?: number;
  /** Group heading in the sidebar's module view (multi-area modules). */
  group?: string;
};

export type ModuleDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Landing page when the module is picked from the switcher. */
  href: string;
  matcher: (path: string) => boolean;
  items: ModuleNavItem[];
};

/** Page data bits a module's item list may depend on (toggles, org kind, plugins). */
export type ModuleNavData = {
  schedulingEnabled?: boolean;
  orgKind?: 'business' | 'personal';
  /** Installed plugin control centers (pluginNavState.controlCenters). */
  plugins?: Array<{ pluginId: string; title: string; icon?: unknown }>;
};

/** Default matcher: the page itself plus everything nested under it. */
const own = (href: string) => (p: string) => p === href || p.startsWith(`${href}/`);

/**
 * Per-area page lists. An "area" is one route subtree (/crm, /socials, …); a
 * module is one or more areas. Section navs read their own area from here.
 */
export type AreaId = 'pos' | 'crm' | 'socials' | 'scheduling' | 'stock' | 'finances' | 'workforce';

export function getAreaItems(area: AreaId, data: ModuleNavData = {}): ModuleNavItem[] {
  switch (area) {
    case 'pos':
      return [
        {
          id: 'sell',
          href: '/pos/sell',
          label: m.pos_nav_sell(),
          icon: ShoppingCart,
          matcher: own('/pos/sell'),
        },
        // No refills tab: manual stock operations live ONLY in the stock module
        // (/stock/entries). POS owns recipes + commerce, and posts its own
        // sourced stock issues on ticket close.
        ...(data.schedulingEnabled
          ? [
              {
                id: 'appointments',
                href: '/pos/appointments',
                label: m.pos_nav_appointments(),
                icon: CalendarDays,
                matcher: own('/pos/appointments'),
              },
            ]
          : []),
        {
          id: 'accounts',
          href: '/pos/accounts',
          label: m.pos_nav_accounts(),
          icon: Wallet,
          matcher: own('/pos/accounts'),
        },
        {
          id: 'catalog',
          href: '/pos/catalog',
          label: m.pos_nav_catalog(),
          icon: LayoutGrid,
          matcher: own('/pos/catalog'),
        },
        {
          id: 'settings',
          href: '/pos/settings',
          label: m.pos_nav_settings(),
          icon: Settings2,
          matcher: own('/pos/settings'),
        },
      ];
    case 'crm':
      return [
        {
          id: 'dashboard',
          href: '/crm',
          label: m.crm_nav_dashboard(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/crm',
        },
        {
          id: 'insights',
          href: '/crm/insights',
          label: m.crm_nav_insights(),
          icon: Sparkles,
          indent: 1,
          matcher: (p) => p.startsWith('/crm/insights'),
        },
        {
          id: 'customers',
          href: '/crm/customers',
          label: m.crm_nav_customers(),
          icon: Users,
          // Customers owns the ranked list and every contact drill-down (/crm/<id>).
          matcher: (p) =>
            p.startsWith('/crm/customers') ||
            (p.startsWith('/crm/') &&
              p !== '/crm' &&
              !p.startsWith('/crm/settings') &&
              !p.startsWith('/crm/cleanup') &&
              !p.startsWith('/crm/insights')),
        },
        {
          id: 'settings',
          href: '/crm/settings',
          label: m.crm_nav_settings(),
          icon: Settings,
          matcher: (p) => p.startsWith('/crm/settings') || p.startsWith('/crm/cleanup'),
        },
      ];
    case 'socials':
      return [
        {
          id: 'dashboard',
          href: '/socials',
          label: m.nav_ads(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/socials',
        },
        {
          id: 'campaigns',
          href: '/socials/campaigns',
          label: m.ads_nav_campaigns(),
          icon: Target,
          matcher: own('/socials/campaigns'),
        },
        {
          id: 'posts',
          href: '/socials/posts',
          label: m.ads_nav_posts(),
          icon: Image,
          matcher: own('/socials/posts'),
        },
        {
          id: 'settings',
          href: '/socials/settings',
          label: m.nav_settings(),
          icon: Settings,
          matcher: (p) => p.startsWith('/socials/settings'),
        },
      ];
    case 'scheduling':
      return [
        {
          id: 'dashboard',
          href: '/scheduling',
          label: m.sched_nav_dashboard(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/scheduling',
        },
        {
          id: 'calendar',
          href: '/scheduling/calendar',
          label: m.sched_nav_calendar(),
          icon: CalendarDays,
          matcher: own('/scheduling/calendar'),
        },
        {
          id: 'bookings',
          href: '/scheduling/bookings',
          label: m.sched_nav_bookings(),
          icon: CalendarClock,
          matcher: own('/scheduling/bookings'),
        },
        {
          id: 'resources',
          // /scheduling/resources redirects to /team (hub-team-hr-module spec S4).
          href: '/team',
          label: m.sched_nav_resources(),
          icon: Users,
          matcher: own('/team'),
        },
        {
          id: 'eventTypes',
          href: '/scheduling/event-types',
          label: m.sched_nav_eventTypes(),
          icon: Sparkles,
          matcher: own('/scheduling/event-types'),
        },
        {
          id: 'links',
          href: '/scheduling/links',
          label: m.sched_nav_links(),
          icon: Link2,
          matcher: own('/scheduling/links'),
        },
        {
          id: 'reminders',
          href: '/scheduling/reminders',
          label: m.sched_nav_reminders(),
          icon: BellRing,
          matcher: own('/scheduling/reminders'),
        },
        {
          id: 'settings',
          href: '/scheduling/settings',
          label: m.sched_nav_settings(),
          icon: Settings,
          matcher: own('/scheduling/settings'),
        },
      ];
    case 'stock':
      return [
        {
          id: 'overview',
          href: '/stock',
          label: m.stock_nav_overview(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/stock',
        },
        {
          id: 'items',
          href: '/stock/items',
          label: m.stock_nav_items(),
          icon: Package,
          matcher: own('/stock/items'),
        },
        {
          id: 'warehouses',
          href: '/stock/warehouses',
          label: m.stock_nav_warehouses(),
          icon: Warehouse,
          matcher: own('/stock/warehouses'),
        },
        {
          id: 'entries',
          href: '/stock/entries',
          label: m.stock_nav_entries(),
          icon: ArrowLeftRight,
          matcher: own('/stock/entries'),
        },
        {
          id: 'commitments',
          href: '/stock/commitments',
          label: m.stock_nav_commitments(),
          icon: CalendarClock,
          matcher: own('/stock/commitments'),
        },
      ];
    case 'finances':
      return [
        {
          id: 'dashboard',
          href: '/finances',
          label: m.nav_finance(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/finances',
        },
        {
          id: 'invoices',
          href: '/finances/invoices',
          label: m.fin_nav_invoices(),
          icon: FileText,
          matcher: own('/finances/invoices'),
        },
        {
          id: 'purchases',
          href: '/finances/purchases',
          label: m.fin_nav_purchases(),
          icon: Receipt,
          matcher: own('/finances/purchases'),
        },
        {
          id: 'settings',
          href: '/finances/settings',
          label: m.nav_settings(),
          icon: Settings,
          matcher: own('/finances/settings'),
        },
      ];
    case 'workforce':
      // Mirrors KanbanNavRail (order + icons follow the route registry).
      return [
        {
          id: 'dashboard',
          href: '/workforce',
          label: m.workforce_dashboard(),
          icon: LayoutDashboard,
          matcher: (p) => p === '/workforce',
        },
        {
          id: 'issues',
          href: '/workforce/issues',
          label: m.workforce_issues(),
          icon: Inbox,
          matcher: own('/workforce/issues'),
        },
        {
          id: 'inbox',
          href: '/workforce/inbox',
          label: m.workforce_inbox(),
          icon: MailOpen,
          matcher: own('/workforce/inbox'),
        },
        {
          id: 'approvals',
          href: '/workforce/approvals',
          label: m.workforce_approvals(),
          icon: CheckCircle2,
          matcher: own('/workforce/approvals'),
        },
        {
          id: 'goals',
          href: '/workforce/goals',
          label: m.workforce_goals(),
          icon: Target,
          matcher: own('/workforce/goals'),
        },
        {
          id: 'portfolios',
          href: '/workforce/portfolios',
          label: m.workforce_portfolios(),
          icon: Layers,
          matcher: own('/workforce/portfolios'),
        },
        {
          id: 'projects',
          href: '/workforce/projects',
          label: m.workforce_projects(),
          icon: FolderKanban,
          matcher: own('/workforce/projects'),
        },
        {
          id: 'org',
          href: '/workforce/org',
          label: m.workforce_org(),
          icon: Users,
          matcher: own('/workforce/org'),
        },
      ];
  }
}

/** Tag every item with the group heading the module view shows above it. */
function grouped(items: ModuleNavItem[], group: string): ModuleNavItem[] {
  return items.map((it) => ({ ...it, id: `${group}:${it.id}`, group }));
}

/**
 * The Agents and Organization modules reuse the sidebar's own core sections —
 * those lists already carry their query-aware matchers and the org-kind
 * filtering, so mirroring them here would just be a second copy that drifts.
 */
function sectionItems(id: 'agents' | 'organization', data: ModuleNavData): ModuleNavItem[] {
  const section = getSections(data.orgKind).find((s) => s.id === id);
  return (section?.items ?? []).map((it) => ({
    id: it.href,
    href: it.href,
    label: it.label,
    icon: it.icon,
    matcher: it.matcher,
    activeWhen: it.activeWhen,
  }));
}

/** All modules with a defined page list, in display order. */
export function getModules(data: ModuleNavData = {}): ModuleDef[] {
  return [
    {
      id: 'pos',
      label: m.nav_pos(),
      icon: Store,
      href: '/pos/sell',
      matcher: (p) => p.startsWith('/pos'),
      items: getAreaItems('pos', data),
    },
    {
      id: 'marketing',
      label: m.nav_marketing(),
      icon: Megaphone,
      href: '/crm',
      matcher: (p) => p.startsWith('/crm') || p.startsWith('/socials'),
      items: [
        ...grouped(getAreaItems('crm', data), m.crm_title()),
        ...grouped(getAreaItems('socials', data), m.nav_ads()),
      ],
    },
    {
      id: 'agents',
      label: m.nav_agentsGroup(),
      icon: Bot,
      href: '/agents',
      matcher: (p) =>
        p.startsWith('/agents') ||
        p.startsWith('/capabilities') ||
        p.startsWith('/flow-editor') ||
        p.startsWith('/prompt') ||
        p.startsWith('/brains'),
      items: sectionItems('agents', data),
    },
    {
      id: 'scheduling',
      label: m.nav_scheduling(),
      icon: CalendarClock,
      href: '/scheduling',
      matcher: (p) => p.startsWith('/scheduling'),
      items: getAreaItems('scheduling', data),
    },
    {
      id: 'stock',
      label: m.nav_stock(),
      icon: Warehouse,
      href: '/stock',
      matcher: (p) => p.startsWith('/stock'),
      items: getAreaItems('stock', data),
    },
    {
      id: 'finance',
      label: m.nav_finance(),
      icon: Wallet,
      href: '/finances',
      matcher: (p) =>
        p.startsWith('/finances') || p.startsWith('/sales') || p.startsWith('/memberships'),
      // Flat on purpose: sales orders and memberships are finance documents,
      // not a separate area worth its own heading.
      items: [
        ...getAreaItems('finances', data).filter((i) => i.id !== 'settings'),
        {
          id: 'sales',
          href: '/sales',
          label: m.nav_salesOrders(),
          icon: ClipboardList,
          matcher: own('/sales'),
        },
        {
          id: 'memberships',
          href: '/memberships',
          label: m.nav_memberships(),
          icon: RefreshCw,
          matcher: own('/memberships'),
        },
        ...getAreaItems('finances', data).filter((i) => i.id === 'settings'),
      ],
    },
    {
      id: 'operations',
      label: m.nav_operations(),
      icon: FolderKanban,
      href: '/work',
      matcher: (p) => p.startsWith('/work') || p.startsWith('/pulse'),
      items: [
        {
          id: 'work',
          href: '/work',
          label: m.nav_myWork(),
          icon: Inbox,
          matcher: own('/work'),
        },
        {
          id: 'pulse',
          href: '/pulse',
          label: m.nav_pulse(),
          icon: Activity,
          matcher: own('/pulse'),
        },
        ...grouped(getAreaItems('workforce', data), m.nav_workforce()),
      ],
    },
    {
      id: 'support',
      label: m.nav_customerSupport(),
      icon: LifeBuoy,
      href: '/support',
      matcher: (p) => p.startsWith('/support') || p.startsWith('/channels'),
      items: [
        {
          id: 'inbox',
          href: '/support',
          label: m.nav_support(),
          icon: LifeBuoy,
          matcher: own('/support'),
        },
        {
          id: 'channels',
          href: '/channels',
          label: m.nav_channels(),
          icon: MessagesSquare,
          matcher: own('/channels'),
        },
      ],
    },
    {
      id: 'organization',
      label: m.nav_organization(),
      icon: Building2,
      href: '/home',
      matcher: (p) =>
        p === '/' || p.startsWith('/home') || p.startsWith('/overview') || p.startsWith('/team'),
      items: sectionItems('organization', data),
    },
    {
      id: 'platform',
      label: m.nav_platform(),
      icon: Wrench,
      href: '/settings',
      matcher: (p) =>
        p.startsWith('/reliability') ||
        p.startsWith('/marketplace') ||
        p.startsWith('/cloud') ||
        p.startsWith('/killswitches') ||
        p.startsWith('/settings'),
      items: [
        {
          id: 'reliability',
          href: '/reliability',
          label: m.nav_reliability(),
          icon: Activity,
          matcher: own('/reliability'),
        },
        {
          id: 'marketplace',
          href: '/marketplace',
          label: m.nav_marketplace(),
          icon: Store,
          matcher: own('/marketplace'),
        },
        {
          id: 'cloud',
          href: '/cloud',
          label: m.nav_cloud(),
          icon: Cloud,
          matcher: own('/cloud'),
        },
        {
          id: 'killswitches',
          href: '/killswitches',
          label: m.nav_killSwitches(),
          icon: Power,
          matcher: own('/killswitches'),
        },
        {
          id: 'settings',
          href: '/settings',
          label: m.nav_settings(),
          icon: Settings,
          matcher: own('/settings'),
        },
      ],
    },
    // Installed plugin control centers — dynamic, so the module only exists
    // when the gateway reports at least one.
    ...(data.plugins?.length
      ? [
          {
            id: 'tools',
            label: m.nav_tools_group(),
            icon: Wrench,
            href: `/plugins/${data.plugins[0].pluginId}`,
            matcher: (p: string) => p.startsWith('/plugins'),
            items: data.plugins.map((e) => ({
              id: e.pluginId,
              href: `/plugins/${e.pluginId}`,
              label: e.title,
              icon: resolvePluginIcon(e.icon as never),
              matcher: own(`/plugins/${e.pluginId}`),
            })),
          },
        ]
      : []),
  ];
}

/**
 * Modules the acting user can actually open: items filtered by `canView` (pass
 * `canViewPath`), modules with nothing left dropped, and `href` re-pointed at
 * the first page they may see so the switcher never lands on a 403.
 */
export function visibleModules(
  data: ModuleNavData,
  canView: (href: string) => boolean,
): ModuleDef[] {
  return getModules(data)
    .map((mod) => ({ ...mod, items: mod.items.filter((it) => canView(it.href)) }))
    .filter((mod) => mod.items.length > 0)
    .map((mod) => ({ ...mod, href: canView(mod.href) ? mod.href : mod.items[0].href }));
}

/** The module owning `path`, or null when the path is outside every module. */
export function resolveModuleForNav(path: string, data: ModuleNavData = {}): ModuleDef | null {
  const p = canonicalPath(path.split(/[?#]/, 1)[0] || '/');
  return getModules(data).find((mod) => mod.matcher(p)) ?? null;
}
