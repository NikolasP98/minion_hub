import { canonicalPath } from '$lib/canonical-path';
import type { ComponentType, SvelteComponent } from "svelte";
import {
    FolderKanban,
    Contact,
    UserRound,
    Zap,
    Boxes,
    Wallet,
    CalendarClock,
    LifeBuoy,
    ClipboardList,
    Inbox,
    RefreshCw,
    MessagesSquare,
    Warehouse,
    Megaphone,
    Store,
    Activity,
} from "lucide-svelte";
import { ROUTES, SECTION_META, type SectionId, type SectionTone } from "$lib/nav/routes";
import { resolvePluginIcon } from "$lib/plugins/icon-map";
import type { PluginUiManifestOccupant } from "$lib/plugins/plugin-types";
import { isModuleVisibleForKind } from "$lib/org-kind";
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
    // Optional override for the per-org module gate id derived from the
    // href's first path segment (see BUILTIN_PLUGIN_ITEMS below). Only needed
    // when the route segment no longer matches the module id — e.g. /socials
    // routes to the 'ads' module.
    moduleId?: string;
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
            (canonicalPath(url.pathname) === "/agents" || canonicalPath(url.pathname).startsWith("/agents/")) &&
            url.searchParams.get("archetype") === archetype,
    };
}

/**
 * Build the static core nav sections (always present): Organization (Home,
 * Overview, Team — Team drops for personal orgs, R1/kind matrix) and Agents
 * (Copilots / AI Brains / Autonomous archetype filters, then Capabilities /
 * Agent Builder / Prompt authoring tools). `orgKind` defaults to business
 * (matches `isModuleVisibleForKind`'s unknown-kind fallback), so existing
 * no-arg callers are unaffected.
 */
export function getSections(orgKind?: "business" | "personal"): Section[] {
    const agentItems: SectionItem[] = [
        archetypeItem("copilot", m.nav_copilots(), UserRound),
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
    const isPersonal = orgKind === "personal";
    // Same moduleId-derivation + isModuleVisibleForKind gate the dynamic
    // plugin items use below (R2: one seam for nav kind-filtering) — drops
    // /team for personal via ORG_KIND_POLICY, no separate branch needed.
    const organizationItems = routeItems("organization").filter((it) =>
        isModuleVisibleForKind(it.href.replace(/^\//, "").split("/")[0], orgKind),
    );
    return [
        {
            id: "organization",
            label: isPersonal ? m.nav_mySpace() : SECTION_META.organization.label(),
            tone: SECTION_META.organization.tone,
            items: organizationItems,
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

/**
 * Plugin manifest taxonomy → business-domain nav buckets. `my-space` and
 * `relationships` are PERSONAL-ONLY display buckets (R2) — they never appear
 * for business orgs and are resolved purely by category overrides in
 * `getDynamicPluginsSections`, not by any gateway plugin manifest category.
 */
type PluginNavCategory =
    | "marketing"
    | "operations"
    | "finance"
    | "creative"
    | "customer-support"
    | "channel"
    | "tool"
    | "my-space"
    | "relationships";

/**
 * Built-in plugin entries surfaced regardless of which gateway plugins are
 * installed. KANBAN is the hub-native paperclip integration (the /workforce
 * subtree); CRM is the hub-native contacts surface. Each builtin carries the
 * business category that decides which nav group it lands in.
 */
export const BUILTIN_PLUGIN_ITEMS: Array<{ category: PluginNavCategory; item: SectionItem }> = [
    {
        category: "marketing",
        item: {
            href: "/crm",
            label: "CRM",
            icon: Contact,
            matcher: (p: string) => p.startsWith("/crm"),
        },
    },
    {
        category: "marketing",
        item: {
            href: "/socials",
            label: m.nav_ads(),
            icon: Megaphone,
            matcher: (p: string) => p.startsWith("/socials"),
            moduleId: "ads",
        },
    },
    {
        category: "operations",
        item: {
            href: "/work",
            label: m.nav_myWork(),
            icon: Inbox,
            matcher: (p: string) => p === "/work" || p.startsWith("/work/"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/workforce",
            label: m.nav_workforce(),
            icon: FolderKanban,
            matcher: (p: string) => p.startsWith("/workforce"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/scheduling",
            label: m.nav_scheduling(),
            icon: CalendarClock,
            matcher: (p: string) => p.startsWith("/scheduling"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/stock",
            label: m.nav_stock(),
            icon: Warehouse,
            matcher: (p: string) => p.startsWith("/stock"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/pos",
            label: m.nav_pos(),
            icon: Store,
            matcher: (p: string) => p.startsWith("/pos"),
        },
    },
    {
        category: "operations",
        item: {
            href: "/pulse",
            label: m.nav_pulse(),
            icon: Activity,
            matcher: (p: string) => p.startsWith("/pulse"),
        },
    },
    {
        category: "finance",
        item: {
            href: "/finances",
            label: m.nav_finances(),
            icon: Wallet,
            matcher: (p: string) => p.startsWith("/finances"),
        },
    },
    {
        category: "finance",
        item: {
            href: "/sales",
            label: m.nav_salesOrders(),
            icon: ClipboardList,
            matcher: (p: string) => p.startsWith("/sales"),
        },
    },
    {
        category: "finance",
        item: {
            href: "/memberships",
            label: m.nav_memberships(),
            icon: RefreshCw,
            matcher: (p: string) => p.startsWith("/memberships"),
        },
    },
    {
        category: "customer-support",
        item: {
            href: "/support",
            label: m.nav_support(),
            icon: LifeBuoy,
            matcher: (p: string) => p.startsWith("/support"),
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
 * Personal-org nav groups (R2). `my-space` merges into the static
 * "organization" section (Home/Overview) by `getNavSections` below — it is
 * NOT rendered as its own section here (excluded from this list on purpose).
 * `relationships` replaces marketing/customer-support; `finance` is relabeled
 * "Money"; `tool` stays the catch-all for whatever plugins remain permitted.
 */
const PLUGIN_NAV_GROUPS_PERSONAL: ReadonlyArray<{ category: PluginNavCategory; label: () => string }> = [
    { category: "relationships", label: () => m.nav_relationships() },
    { category: "finance", label: () => m.nav_money() },
    { category: "tool", label: () => m.nav_tools_group() },
];

/**
 * Personal-only display placement overrides (R2). Business plugin/manifest
 * categories are untouched — this is purely a hub-side nav-grouping map,
 * keyed by the same moduleId/pluginId the business-category resolution
 * already uses. `pulse`/`work` land in `my-space` (merged into the
 * "organization"/My Space section by `getNavSections`); `crm`/`scheduling`
 * and the voice-call plugin land in `relationships` alongside Channels.
 */
const PERSONAL_CATEGORY_OVERRIDES: Record<string, PluginNavCategory> = {
    pulse: "my-space",
    work: "my-space",
    crm: "relationships",
    scheduling: "relationships",
    "voice-call": "relationships",
    voicecall: "relationships",
};

/**
 * First-party plugin → category overrides. The running gateway may predate the
 * business-domain manifest categories (it would then report "tool"/"automation"/
 * "channel"), so we pin known first-party plugins to their intended group here.
 * This keeps the sidebar correct without waiting on a gateway redeploy; unknown
 * plugins still fall through to their manifest-reported category. Keyed by
 * pluginId (a few carry legacy ids — e.g. voice-call also ships as "voicecall").
 */
const PLUGIN_CATEGORY_OVERRIDES: Record<string, PluginNavCategory> = {
    "voice-call": "customer-support",
    voicecall: "customer-support",
    studio: "creative",
    crm: "marketing",
    paperclip: "operations",
    kanban: "operations",
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
    orgKind?: "business" | "personal",
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

    const isPersonal = orgKind === "personal";
    // Personal has no Marketing/Operations/Branding/Customer-Support groups
    // (PLUGIN_NAV_GROUPS_PERSONAL) — anything not explicitly placed in
    // my-space/relationships/finance collapses into the Tools catch-all.
    // "channel" is exempt — `place()` special-cases it into channelItems
    // before any category bucketing happens, for both kinds.
    const PERSONAL_KEPT_CATEGORIES = new Set<PluginNavCategory>(["my-space", "relationships", "finance", "channel"]);
    const personalize = (id: string, category: PluginNavCategory): PluginNavCategory => {
        if (!isPersonal) return category;
        if (PERSONAL_CATEGORY_OVERRIDES[id]) return PERSONAL_CATEGORY_OVERRIDES[id];
        return PERSONAL_KEPT_CATEGORIES.has(category) ? category : "tool";
    };

    for (const { category, item } of BUILTIN_PLUGIN_ITEMS) {
        // 'crm' | 'finances' | 'workforce' | ... — falls back to the href's
        // first segment unless the item overrides it (e.g. /socials -> 'ads').
        const moduleId = item.moduleId ?? item.href.replace(/^\//, "").split("/")[0];
        if (enabledByPluginId[moduleId] === false) continue; // per-org module gate
        if (!isModuleVisibleForKind(moduleId, orgKind)) continue;
        // Personal-only relabel: the CRM item reads "People" (R2) — data-only,
        // the underlying route/module is unchanged.
        const effectiveItem = isPersonal && moduleId === "crm" ? { ...item, label: m.nav_people() } : item;
        place(personalize(moduleId, category), effectiveItem);
    }
    for (const e of entries) {
        // Per-org gate: a plugin disabled for the acting org is removed from the
        // nav entirely (its route also 404s). Reactive — re-runs when the toggle
        // updates pluginNavState.enabledByPluginId, so the link appears/vanishes
        // with no reload.
        if (enabledByPluginId[e.pluginId] === false) continue;
        // Kind gate (R2/R6: sections.ts:351 gap) — installed plugins go through
        // the same isModuleVisibleForKind predicate as builtins. No installed
        // plugin id is in ORG_KIND_POLICY today, so this is a no-op unless a
        // future plugin id collides with a hidden module id — safety net.
        if (!isModuleVisibleForKind(e.pluginId, orgKind)) continue;
        const category = PLUGIN_CATEGORY_OVERRIDES[e.pluginId] ?? normalizePluginCategory(e.category);
        place(personalize(e.pluginId, category), {
            href: `/plugins/${e.pluginId}`,
            label: e.title,
            icon: resolvePluginIcon(e.icon),
            matcher: (p: string) => p.startsWith(`/plugins/${e.pluginId}`),
        });
    }

    // Channels collapse into a single "Channels" link — under Customer Support
    // for business, folded into Relationships for personal (R2); the enabled
    // channels themselves live on the /channels secondary side-menu.
    if (channelItems.length) {
        const target = isPersonal ? "relationships" : "customer-support";
        const list = byCategory.get(target) ?? [];
        list.push({
            href: "/channels",
            label: m.nav_channels(),
            icon: MessagesSquare,
            matcher: (p: string) => p.startsWith("/channels"),
        });
        byCategory.set(target, list);
    }

    const sections: Section[] = [];
    for (const group of isPersonal ? PLUGIN_NAV_GROUPS_PERSONAL : PLUGIN_NAV_GROUPS) {
        const items = byCategory.get(group.category) ?? [];
        if (items.length === 0) continue;
        sections.push({
            id: `plugins:${group.category}`,
            label: group.label(),
            tone: "accent",
            items,
        });
    }
    // "my-space" is personal-only and merges into the static organization
    // section (getNavSections) — never surfaced as its own section here.
    if (isPersonal) {
        const myItems = byCategory.get("my-space") ?? [];
        if (myItems.length) {
            sections.unshift({ id: "plugins:my-space", label: m.nav_mySpace(), tone: "accent", items: myItems });
        }
    }
    return sections;
}

/**
 * Compose the static core sections and the dynamic plugin sections into the
 * final nav list, kind-aware. For personal orgs the "my-space" plugin bucket
 * (Pulse, My Work) is folded into the static "organization"/My Space section
 * so Home/Overview/Pulse/My Work render as ONE group — same "insert after
 * assembly" pattern the Channels→Customer Support fold already uses inside
 * `getDynamicPluginsSections`. Business orgs are a plain concat, unchanged.
 * Single call site for Sidebar/Topbar so both stay in lockstep (R2 mobile
 * parity: they share this + `nav-order.ts`).
 */
export function getNavSections(
    orgKind: "business" | "personal" | undefined,
    entries: PluginUiManifestOccupant[],
    enabledByPluginId: Record<string, boolean> = {},
): Section[] {
    const staticSections = getSections(orgKind);
    const pluginSections = getDynamicPluginsSections(entries, enabledByPluginId, orgKind);
    if (orgKind !== "personal") return [...staticSections, ...pluginSections];

    const myPlugins = pluginSections.find((s) => s.id === "plugins:my-space");
    const rest = pluginSections.filter((s) => s.id !== "plugins:my-space");
    if (!myPlugins) return [...staticSections, ...rest];

    const merged = staticSections.map((s) =>
        s.id === "organization" ? { ...s, items: [...s.items, ...myPlugins.items] } : s,
    );
    return [...merged, ...rest];
}
