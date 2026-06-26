import type { ComponentType, SvelteComponent } from "svelte";
import { FolderKanban, Contact, UserRound, BrainCircuit, Zap, Boxes, Wallet, CalendarClock, LifeBuoy, ClipboardList, Inbox, RefreshCw, MessagesSquare } from "lucide-svelte";
import {
    ROUTES,
    SECTION_META,
    type SectionId,
    type SectionTone,
} from "$lib/nav/routes";
import { resolvePluginIcon } from "$lib/plugins/icon-map";
import type { PluginUiManifestOccupant } from "$lib/plugins/plugin-types";
import * as m from "$lib/paraglide/messages";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
type LucideIcon = ComponentType<SvelteComponent<{ size?: number | string; class?: string }>>;

export type { SectionTone };

/** Agent archetypes the roster nav filters by (mirrors gateway agents.list[].archetype). */
export type AgentArchetype = "copilot" | "brain" | "autonomous";

export type SectionItem = {
    href: string;
    label: string;
    icon: LucideIcon | string;
    /** Path-based active matcher. */
    matcher: (path: string) => boolean;
    // Query-aware active matcher (archetype roster filters live at /agents
    // with a ?archetype= param). When set it overrides `matcher` for active
    // state so e.g. /agents?archetype=brain lights up "AI Brains" only.
    activeWhen?: (url: URL) => boolean;
    // Optional access-policy key (see $lib/access/policy). When set, the nav
    // item is only rendered for users who satisfy it. Filtered in the sidebar
    // via canClient(); routes are also guarded server-side, so hiding here is
    // UX only.
    requires?: string;
};

export type SubSection = {
    id: string;
    label: string;
    items: SectionItem[];
};

export type Section = {
    // SectionId for core sections; `plugins:<category>` for the dynamic,
    // category-grouped plugin sections built by getDynamicPluginsSections().
    id: SectionId | string;
    label: string;
    tone: SectionTone;
    items: SectionItem[];
    // Collapsible nested groups (Customer Support → Channels). Optional.
    subsections?: SubSection[];
};

/** Map the core route registry entries flagged inNav for a section → SectionItem[]. */
function routeItems(section: SectionId): SectionItem[] {
    return ROUTES.filter((r) => r.inNav && r.section === section).map((r) => ({
        href: r.path,
        label: r.title(),
        icon: r.icon,
        matcher: r.matcher,
        requires: r.requires,
    }));
}

/** Build a roster-filter nav item that lights up only for its ?archetype= value. */
function archetypeItem(archetype: AgentArchetype, label: string, icon: LucideIcon): SectionItem {
    return {
        href: `/agents?archetype=${archetype}`,
        label,
        icon,
        // Never active by path alone — the three archetype items share /agents.
        matcher: () => false,
        activeWhen: (url) =>
            (url.pathname === "/agents" || url.pathname.startsWith("/agents/")) &&
            url.searchParams.get("archetype") === archetype,
    };
}

/**
 * Build the static core nav sections (always present): Organization (Home,
 * Overview, Team) and Agents (Copilots / AI Brains / Autonomous archetype
 * filters, then Capabilities / Agent Builder / Prompt authoring tools).
 */
export function getSections(): Section[] {
    const agentItems: SectionItem[] = [
        archetypeItem("copilot", m.nav_copilots(), UserRound),
        archetypeItem("brain", m.nav_brains(), BrainCircuit),
        {
            href: "/agents/autonomous",
            label: m.nav_autonomous(),
            icon: Zap,
            matcher: (p) => p === "/agents/autonomous" || p.startsWith("/agents/autonomous/"),
        },
        {
            href: "/agents/workshop",
            label: m.nav_workshop(),
            icon: Boxes,
            matcher: (p) => p.startsWith("/agents/workshop"),
        },
        ...routeItems("agents"),
    ];
    return [
        {
            id: "organization",
            label: SECTION_META.organization.label(),
            tone: SECTION_META.organization.tone,
            items: routeItems("organization"),
        },
        {
            id: "agents",
            label: SECTION_META.agents.label(),
            tone: SECTION_META.agents.tone,
            items: agentItems,
        },
    ];
}

export function findActiveSection(sections: Section[], pathname: string): Section | null {
    return sections.find((s) => s.items.some((it) => it.matcher(pathname))) ?? null;
}

/** Plugin manifest taxonomy → business-domain nav buckets. */
type PluginNavCategory =
    | "marketing"
    | "operations"
    | "finance"
    | "creative"
    | "customer-support"
    | "channel"
    | "tool";

/**
 * Built-in plugin entries surfaced regardless of which gateway plugins are
 * installed. KANBAN is the hub-native paperclip integration (the /workforce
 * subtree); CRM is the hub-native contacts surface. Each builtin carries the
 * business category that decides which nav group it lands in.
 */
const BUILTIN_PLUGIN_ITEMS: Array<{ category: PluginNavCategory; item: SectionItem }> = [
    {
        category: "marketing",
        item: {
            href: "/crm",
            label: "CRM",
            icon: Contact,
            matcher: (p: string) => p.startsWith("/crm"),
            requires: "crm.view",
        },
    },
    {
        category: "operations",
        item: {
            href: "/work",
            label: "My Work",
            icon: Inbox,
            matcher: (p: string) => p === "/work" || p.startsWith("/work/"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/workforce",
            label: "Workforce",
            icon: FolderKanban,
            matcher: (p: string) => p.startsWith("/workforce"),
            requires: "projects.view",
        },
    },
    {
        category: "operations",
        item: {
            href: "/scheduling",
            label: "Scheduling",
            icon: CalendarClock,
            matcher: (p: string) => p.startsWith("/scheduling"),
            requires: "scheduling.view",
        },
    },
    {
        category: "finance",
        item: {
            href: "/finances",
            label: "Finances",
            icon: Wallet,
            matcher: (p: string) => p.startsWith("/finances"),
            requires: "finance.view",
        },
    },
    {
        category: "finance",
        item: {
            href: "/sales",
            label: "Sales Orders",
            icon: ClipboardList,
            matcher: (p: string) => p.startsWith("/sales"),
            requires: "sales.view",
        },
    },
    {
        category: "finance",
        item: {
            href: "/memberships",
            label: "Memberships",
            icon: RefreshCw,
            matcher: (p: string) => p.startsWith("/memberships"),
            requires: "memberships.view",
        },
    },
    {
        category: "customer-support",
        item: {
            href: "/support",
            label: "Support",
            icon: LifeBuoy,
            matcher: (p: string) => p.startsWith("/support"),
            requires: "support.view",
        },
    },
];

/**
 * Plugin nav groups, in display order. Plugins are bucketed by their manifest
 * `category` into business domains. `channel` plugins (whatsapp/telegram/…) are
 * NOT a top-level group — they render as a collapsible "Channels" subsection
 * under Customer Support. `tool` is the catch-all for anything unmapped.
 */
const PLUGIN_NAV_GROUPS: ReadonlyArray<{ category: PluginNavCategory; label: () => string }> = [
    { category: "marketing", label: () => m.nav_marketing() },
    { category: "operations", label: () => m.nav_operations() },
    { category: "finance", label: () => m.nav_finance() },
    { category: "creative", label: () => m.nav_branding() },
    { category: "customer-support", label: () => m.nav_customerSupport() },
    { category: "tool", label: () => m.nav_tools_group() },
];

/**
 * First-party plugin → category overrides. The running gateway may predate the
 * business-domain manifest categories (it would then report "tool"/"automation"/
 * "channel"), so we pin known first-party plugins to their intended group here.
 * This keeps the sidebar correct without waiting on a gateway redeploy; unknown
 * plugins still fall through to their manifest-reported category. Keyed by
 * pluginId (a few carry legacy ids — e.g. voice-call also ships as "voicecall").
 */
const PLUGIN_CATEGORY_OVERRIDES: Record<string, PluginNavCategory> = {
    'voice-call': 'customer-support',
    voicecall: 'customer-support',
    studio: 'creative',
    crm: 'marketing',
    paperclip: 'operations',
    kanban: 'operations',
};

/**
 * True when a plugin belongs in the Channels group (whatsapp/telegram/discord…).
 * Applies the same first-party override → manifest-category resolution the nav
 * uses, so the channels secondary menu stays in lockstep with the sidebar.
 */
export function isChannelPlugin(e: PluginUiManifestOccupant): boolean {
    const category = PLUGIN_CATEGORY_OVERRIDES[e.pluginId] ?? normalizePluginCategory(e.category);
    return category === "channel";
}

/** Coerce a raw manifest category string into a known nav bucket. */
function normalizePluginCategory(raw: string | undefined): PluginNavCategory {
    switch (raw) {
        case "marketing":
        case "operations":
        case "finance":
        case "creative":
        case "customer-support":
        case "channel":
        case "tool":
            return raw;
        // Legacy taxonomy → business-domain remap.
        case "automation":
            return "customer-support";
        case "dashboard":
            return "tool";
        default:
            return "tool";
    }
}

/**
 * Build the plugin nav sections from live plugin control-center manifests,
 * bucketed by business category (Marketing, Operations, Branding/Creative,
 * Customer Support, Tools). Channel plugins are folded into a collapsible
 * Channels subsection under Customer Support. Returns [] when nothing maps.
 */
export function getDynamicPluginsSections(
    entries: PluginUiManifestOccupant[],
    enabledByPluginId: Record<string, boolean> = {},
): Section[] {
    const byCategory = new Map<PluginNavCategory, SectionItem[]>();
    const channelItems: SectionItem[] = [];

    const place = (category: PluginNavCategory, item: SectionItem) => {
        if (category === "channel") {
            channelItems.push(item);
            return;
        }
        const list = byCategory.get(category) ?? [];
        list.push(item);
        byCategory.set(category, list);
    };

    for (const { category, item } of BUILTIN_PLUGIN_ITEMS) {
        const moduleId = item.href.replace(/^\//, '').split('/')[0]; // 'crm' | 'finances' | 'workforce'
        if (enabledByPluginId[moduleId] === false) continue;          // per-org module gate
        place(category, item);
    }
    for (const e of entries) {
        // Per-org gate: a plugin disabled for the acting org is removed from the
        // nav entirely (its route also 404s). Reactive — re-runs when the toggle
        // updates pluginNavState.enabledByPluginId, so the link appears/vanishes
        // with no reload.
        if (enabledByPluginId[e.pluginId] === false) continue;
        const category =
            PLUGIN_CATEGORY_OVERRIDES[e.pluginId] ?? normalizePluginCategory(e.category);
        place(category, {
            href: `/plugins/${e.pluginId}`,
            label: e.title,
            icon: resolvePluginIcon(e.icon),
            matcher: (p: string) => p.startsWith(`/plugins/${e.pluginId}`),
        });
    }

    // Channels collapse into a single "Channels" link under Customer Support;
    // the enabled channels themselves live on the /channels secondary side-menu.
    if (channelItems.length) {
        const cs = byCategory.get("customer-support") ?? [];
        cs.push({
            href: "/channels",
            label: m.nav_channels(),
            icon: MessagesSquare,
            matcher: (p: string) => p.startsWith("/channels"),
        });
        byCategory.set("customer-support", cs);
    }

    const sections: Section[] = [];
    for (const group of PLUGIN_NAV_GROUPS) {
        const items = byCategory.get(group.category) ?? [];
        if (items.length === 0) continue;
        sections.push({
            id: `plugins:${group.category}`,
            label: group.label(),
            tone: "accent",
            items,
        });
    }
    return sections;
}
