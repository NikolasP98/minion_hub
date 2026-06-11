/**
 * Canonical route-metadata registry.
 *
 * Single source of truth for navigable app routes — feeds the sidebar
 * (`components/layout/sections.ts`), the command palette
 * (`state/ui/command-palette.svelte.ts`), and page-title resolution
 * (`<PageHeader>`). Adding a top-level page here wires it into all three.
 */
import {
    Briefcase,
    Zap,
    Sparkles,
    LayoutDashboard,
    Users,
    GitBranch,
    Wrench,
    Store,
    Wand2,
    Inbox,
    CheckCircle2,
    Target,
    FolderKanban,
    Activity,
    Settings,
    MessagesSquare,
    Bell,
    Network,
} from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";
import * as m from "$lib/paraglide/messages";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5.
export type LucideIcon = ComponentType<
    SvelteComponent<{ size?: number | string; class?: string }>
>;

export type SectionId = "workforce" | "gateway" | "creative";
export type SectionTone = "accent" | "brand";

// Top-level product domain. The hub spans two surfaces — the agent-company
// control plane (Workforce) and the live gateway dashboard (Gateway/Creative/
// Plugins). Super-labels in the sidebar keep them legible as distinct domains
// without hiding either (council #12, "clarify grouping").
export type NavDomain = "control-plane" | "gateway";
export const DOMAIN_LABEL: Record<NavDomain, string> = {
    "control-plane": "Control plane",
    gateway: "Gateway",
};

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
    { label: string; icon: LucideIcon; tone: SectionTone; domain: NavDomain }
> = {
    workforce: { label: "Workforce", icon: Briefcase, tone: "accent", domain: "control-plane" },
    gateway: { label: "Gateway", icon: Zap, tone: "accent", domain: "gateway" },
    creative: { label: "Creative", icon: Sparkles, tone: "brand", domain: "gateway" },
};

/** Display order of nav sections. */
export const SECTION_ORDER: SectionId[] = ["workforce", "gateway", "creative"];

const startsWith = (prefix: string) => (p: string) => p.startsWith(prefix);

export const ROUTES: RouteMeta[] = [
    // ── Workforce ──────────────────────────────────────────────────────────
    {
        path: "/workforce",
        title: () => "Dashboard",
        icon: LayoutDashboard,
        matcher: (p) => p === "/workforce",
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "workforce home overview",
        paletteIcon: "layout-dashboard",
    },
    {
        path: "/workforce/issues",
        title: () => "Issues",
        icon: Inbox,
        matcher: startsWith("/workforce/issues"),
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "tasks bugs work",
        paletteIcon: "inbox",
    },
    {
        path: "/workforce/approvals",
        title: () => "Approvals",
        icon: CheckCircle2,
        matcher: startsWith("/workforce/approvals"),
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "review pending approve",
        paletteIcon: "check",
    },
    {
        path: "/workforce/goals",
        title: () => "Goals",
        icon: Target,
        matcher: startsWith("/workforce/goals"),
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "objectives okr targets",
        paletteIcon: "target",
    },
    {
        path: "/workforce/projects",
        title: () => "Projects",
        icon: FolderKanban,
        matcher: startsWith("/workforce/projects"),
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "kanban board",
        paletteIcon: "folder",
    },
    {
        path: "/workforce/org",
        title: () => "Org",
        icon: Users,
        matcher: startsWith("/workforce/org"),
        section: "workforce",
        inNav: true,
        inPalette: true,
        keywords: "organization team structure",
        paletteIcon: "users",
    },

    // ── Gateway ────────────────────────────────────────────────────────────
    {
        path: "/overview",
        title: () => "Overview",
        icon: Network,
        matcher: startsWith("/overview"),
        section: "gateway",
        inNav: true,
        inPalette: true,
        keywords: "overview graph org areas agents users map network",
        paletteIcon: "git-branch",
    },
    {
        path: "/my-agent",
        title: () => m.nav_agents(),
        icon: Users,
        matcher: (p) => p.startsWith("/my-agent") || p.startsWith("/agents"),
        section: "gateway",
        inNav: true,
        inPalette: true,
        keywords: "personal agent assistant",
        paletteIcon: "user",
    },
    {
        path: "/flow-editor",
        title: () => m.nav_flows(),
        icon: GitBranch,
        matcher: startsWith("/flow-editor"),
        section: "gateway",
        inNav: true,
        inPalette: true,
        keywords: "flows graph editor automation",
        paletteIcon: "git-branch",
    },
    {
        path: "/tools",
        title: () => m.nav_tools(),
        icon: Wrench,
        matcher: startsWith("/tools"),
        section: "gateway",
        inNav: true,
        inPalette: true,
        keywords: "tools gateway custom create edit",
        paletteIcon: "wrench",
    },

    // ── Creative ───────────────────────────────────────────────────────────
    {
        path: "/marketplace",
        title: () => m.nav_marketplace(),
        icon: Store,
        matcher: startsWith("/marketplace"),
        section: "creative",
        inNav: true,
        inPalette: true,
        keywords: "plugins tools browse install",
        paletteIcon: "store",
    },
    {
        path: "/prompt",
        title: () => m.nav_prompt(),
        icon: Wand2,
        matcher: startsWith("/prompt"),
        section: "creative",
        inNav: true,
        inPalette: true,
        keywords: "prompt builder craft",
        paletteIcon: "wand",
    },
    // /studio is now a gateway plugin (extensions/studio). It self-registers in
    // the sidebar via its `plugins.controlCenter` UI slot (getDynamicPluginsSection)
    // and in Settings → Plugins via its `settings.plugins` slot — no static route.

    // ── Standalone (rendered specially in the sidebar / palette-only) ───────
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

/** Flows nav item is visible unless an explicit `false` exists for pluginId "flows". */
export function isFlowsNavVisible(enabledByPluginId: Record<string, boolean>): boolean {
    return enabledByPluginId.flows !== false;
}

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
