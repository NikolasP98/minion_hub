/**
 * Canonical route-metadata registry.
 *
 * Single source of truth for navigable app routes — feeds the sidebar
 * (`components/layout/sections.ts`), the command palette
 * (`state/ui/command-palette.svelte.ts`), and page-title resolution
 * (`<PageHeader>`). Adding a top-level page here wires it into all three.
 */
import {
    Users,
    GitBranch,
    Wrench,
    Store,
    Wand2,
    Inbox,
    MailOpen,
    CheckCircle2,
    Target,
    FolderKanban,
    Activity,
    Settings,
    MessagesSquare,
    Bell,
    Network,
    LayoutDashboard,
    Home,
    Bot,
    Layers,
    Building2,
    UsersRound,
    BrainCircuit,
    Cloud,
} from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";
import * as m from "$lib/paraglide/messages";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5.
export type LucideIcon = ComponentType<
    SvelteComponent<{ size?: number | string; class?: string }>
>;

// Core sidebar sections (always present). Plugin-driven sections (Marketing,
// Operations, Branding/Creative, Customer Support) are built separately in
// `components/layout/sections.ts` from the live plugin manifest categories.
export type SectionId = "organization" | "agents";
export type SectionTone = "accent" | "brand";

export interface RouteMeta {
    /** Canonical path (sidebar href + palette goto target). */
    path: string;
    /** Display title (function so paraglide locale switches stay reactive). */
    title: () => string;
    /** lucide icon component. */
    icon: LucideIcon;
    /** Path matcher for active-state + most-specific title resolution. */
    matcher: (path: string) => boolean;
    /** Section grouping; `undefined` = standalone (reliability/settings/etc). */
    section?: SectionId;
    /** Access-policy key gating visibility (see $lib/access/policy). */
    requires?: string;
    /** Render in the sidebar nav. */
    inNav?: boolean;
    /** Expose as a "page" command in the ⌘K palette. */
    inPalette?: boolean;
    /** Extra fuzzy-search keywords for the palette. */
    keywords?: string;
    /** Palette icon key (see CommandPalette iconMap). */
    paletteIcon?: string;
}

export const SECTION_META: Record<
    SectionId,
    { label: () => string; icon: LucideIcon; tone: SectionTone }
> = {
    organization: { label: () => m.nav_organization(), icon: Building2, tone: "accent" },
    agents: { label: () => m.nav_agentsGroup(), icon: Bot, tone: "accent" },
};

/** Display order of the core nav sections. */
export const SECTION_ORDER: SectionId[] = ["organization", "agents"];

const startsWith = (prefix: string) => (p: string) => p.startsWith(prefix);

export const ROUTES: RouteMeta[] = [
    // ── Organization ─────────────────────────────────────────────────────────
    {
        path: "/home",
        title: () => m.nav_home(),
        icon: Home,
        matcher: (p) => p === "/home" || p.startsWith("/home/"),
        section: "organization",
        inNav: true,
        inPalette: true,
        keywords: "home personal agent assistant feed dashboard",
        paletteIcon: "user",
    },
    {
        path: "/overview",
        title: () => m.nav_overview(),
        icon: Network,
        matcher: startsWith("/overview"),
        section: "organization",
        inNav: true,
        inPalette: true,
        keywords: "overview graph org areas agents users map network",
        paletteIcon: "git-branch",
    },
    {
        path: "/team",
        title: () => m.nav_team(),
        icon: UsersRound,
        matcher: startsWith("/team"),
        section: "organization",
        requires: "users.manage",
        inNav: true,
        inPalette: true,
        keywords: "team members people users invite roles seats",
        paletteIcon: "users",
    },

    // ── Agents ───────────────────────────────────────────────────────────────
    // The Copilots / AI Brains / Autonomous archetype filters and Capabilities
    // are assembled in sections.ts (query-param-aware active state); /agents is
    // here for title + palette resolution.
    {
        path: "/agents",
        title: () => m.nav_agents(),
        icon: Bot,
        matcher: (p) => p === "/agents" || p.startsWith("/agents/"),
        inNav: false,
        inPalette: true,
        keywords: "agents roster copilots brains autonomous list",
        paletteIcon: "user",
    },
    {
        path: "/capabilities",
        title: () => m.nav_capabilities(),
        icon: Wrench,
        matcher: (p) => p.startsWith("/capabilities") || p.startsWith("/tools"),
        section: "agents",
        requires: "agents.view",
        inNav: true,
        inPalette: true,
        keywords: "capabilities tools skills gateway custom create edit",
        paletteIcon: "wrench",
    },
    {
        path: "/flow-editor",
        title: () => m.nav_agentBuilder(),
        icon: GitBranch,
        matcher: startsWith("/flow-editor"),
        section: "agents",
        requires: "flows.view",
        inNav: true,
        inPalette: true,
        keywords: "agent builder flows graph editor automation",
        paletteIcon: "git-branch",
    },
    {
        path: "/prompt",
        title: () => m.nav_prompt(),
        icon: Wand2,
        matcher: startsWith("/prompt"),
        section: "agents",
        requires: "agents.view",
        inNav: true,
        inPalette: true,
        keywords: "prompt builder craft",
        paletteIcon: "wand",
    },
    {
        path: "/brains",
        title: () => m.nav_brains(),
        icon: BrainCircuit,
        matcher: startsWith("/brains"),
        section: "agents",
        requires: "brains.view",
        inNav: true,
        inPalette: true,
        keywords: "ai brains knowledge base rag agents documents search embeddings",
        paletteIcon: "book-open",
    },

    // ── Top icon row (rendered specially in the sidebar) ─────────────────────
    {
        path: "/reliability",
        title: () => m.reliability_title(),
        icon: Activity,
        matcher: startsWith("/reliability"),
        requires: "reliability.monitor",
        inNav: false,
        inPalette: true,
        keywords: "health monitoring events uptime",
        paletteIcon: "activity",
    },
    {
        path: "/marketplace",
        title: () => m.nav_marketplace(),
        icon: Store,
        matcher: startsWith("/marketplace"),
        inNav: false,
        inPalette: true,
        keywords: "plugins tools browse install marketplace",
        paletteIcon: "store",
    },
    {
        path: "/cloud",
        title: () => m.nav_cloud(),
        icon: Cloud,
        matcher: startsWith("/cloud"),
        requires: "workspace.view",
        inNav: false,
        inPalette: true,
        keywords: "cloud workstation vm desktop terminal ssh exe.dev",
        paletteIcon: "cloud",
    },

    // ── Workforce (the "Kanban" plugin) — palette + titles only ──────────────
    // Reached via the Operations → Kanban plugin entry and the KanbanNavRail
    // icon sub-nav inside the /workforce shell. inNav:false keeps them out of
    // the primary rail; inPalette:true keeps them as ⌘K page commands.
    {
        path: "/workforce",
        title: () => "Dashboard",
        icon: LayoutDashboard,
        matcher: (p) => p === "/workforce",
        inNav: false,
        inPalette: true,
        keywords: "workforce home overview kanban",
        paletteIcon: "layout-dashboard",
    },
    {
        path: "/workforce/issues",
        title: () => "Issues",
        icon: Inbox,
        matcher: startsWith("/workforce/issues"),
        inNav: false,
        inPalette: true,
        keywords: "tasks bugs work",
        paletteIcon: "inbox",
    },
    {
        path: "/workforce/inbox",
        title: () => m.workforce_inbox(),
        icon: MailOpen,
        matcher: startsWith("/workforce/inbox"),
        inNav: false,
        inPalette: true,
        keywords: "human review hitl assigned tasks role user",
        paletteIcon: "inbox",
    },
    {
        path: "/workforce/approvals",
        title: () => "Approvals",
        icon: CheckCircle2,
        matcher: startsWith("/workforce/approvals"),
        inNav: false,
        inPalette: true,
        keywords: "review pending approve",
        paletteIcon: "check",
    },
    {
        path: "/workforce/goals",
        title: () => "Goals",
        icon: Target,
        matcher: startsWith("/workforce/goals"),
        inNav: false,
        inPalette: true,
        keywords: "objectives okr targets",
        paletteIcon: "target",
    },
    {
        path: "/workforce/portfolios",
        title: () => "Portfolios",
        icon: Layers,
        matcher: startsWith("/workforce/portfolios"),
        inNav: false,
        inPalette: true,
        keywords: "portfolio charter rollup metrics",
        paletteIcon: "layers",
    },
    {
        path: "/workforce/projects",
        title: () => "Projects",
        icon: FolderKanban,
        matcher: startsWith("/workforce/projects"),
        inNav: false,
        inPalette: true,
        keywords: "kanban board",
        paletteIcon: "folder",
    },
    {
        path: "/workforce/org",
        title: () => "Org",
        icon: Users,
        matcher: startsWith("/workforce/org"),
        inNav: false,
        inPalette: true,
        keywords: "organization team structure",
        paletteIcon: "users",
    },

    // ── Standalone (palette-only / footer) ───────────────────────────────────
    {
        path: "/sessions",
        title: () => "Sessions",
        icon: MessagesSquare,
        matcher: startsWith("/sessions"),
        inNav: false,
        inPalette: true,
        keywords: "conversations history chat",
        paletteIcon: "messages-square",
    },
    {
        path: "/notifications",
        title: () => "Notifications",
        icon: Bell,
        matcher: startsWith("/notifications"),
        requires: "users.manage",
        inNav: false,
        inPalette: true,
        keywords: "alerts join requests pending",
        paletteIcon: "bell",
    },
    {
        path: "/settings",
        title: () => m.nav_settings(),
        icon: Settings,
        matcher: startsWith("/settings"),
        inNav: false,
        inPalette: true,
        keywords: "preferences configuration",
        paletteIcon: "settings",
    },
];

/**
 * Resolve the most specific route title for a pathname. Returns the title of
 * the matching route with the longest `path` (so `/workforce/issues` wins over
 * `/workforce`). `null` when nothing matches.
 */
export function routeTitle(pathname: string): string | null {
    let best: RouteMeta | null = null;
    for (const r of ROUTES) {
        if (r.matcher(pathname) && (!best || r.path.length > best.path.length)) {
            best = r;
        }
    }
    return best ? best.title() : null;
}

/** Routes exposed as palette "page" commands, in registry order. */
export function palettePageRoutes(): RouteMeta[] {
    return ROUTES.filter((r) => r.inPalette);
}
