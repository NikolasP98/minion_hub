import type { ComponentType, SvelteComponent } from "svelte";
import { Puzzle, FolderKanban, Contact } from "lucide-svelte";
import {
    ROUTES,
    SECTION_META,
    SECTION_ORDER,
    DOMAIN_LABEL,
    isFlowsNavVisible,
    type SectionId,
    type SectionTone,
    type NavDomain,
} from "$lib/nav/routes";
import { resolvePluginIcon } from "$lib/plugins/icon-map";
import type { PluginUiManifestOccupant } from "$lib/plugins/plugin-types";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
type LucideIcon = ComponentType<SvelteComponent<{ size?: number | string; class?: string }>>;

export type { SectionTone, NavDomain };
export { DOMAIN_LABEL };

export type SectionItem = {
    href: string;
    label: string;
    icon: LucideIcon | string;
    matcher: (path: string) => boolean;
    // Optional access-policy key (see $lib/access/policy). When set, the nav
    // item is only rendered for users who satisfy it (admin-only "plugin"
    // views). Filtered in the sidebar via canClient(); routes are also guarded
    // server-side, so hiding here is UX only.
    requires?: string;
};

export type Section = {
    // SectionId for static sections; `plugins:<category>` for the dynamic,
    // category-grouped plugin sections built by getDynamicPluginsSections().
    id: SectionId | "plugins" | string;
    label: string;
    icon: LucideIcon;
    tone: SectionTone;
    domain: NavDomain;
    items: SectionItem[];
};

export { isFlowsNavVisible };

/**
 * Build the static nav sections from the canonical route registry
 * (`$lib/nav/routes`). Section grouping/labels/tones come from SECTION_META;
 * items are the registry entries flagged `inNav` for that section, in
 * registry order.
 */
export function getSections(): Section[] {
    return SECTION_ORDER.map((id) => {
        const meta = SECTION_META[id];
        return {
            id,
            label: meta.label,
            icon: meta.icon,
            tone: meta.tone,
            domain: meta.domain,
            items: ROUTES.filter((r) => r.inNav && r.section === id).map((r) => ({
                href: r.path,
                label: r.title(),
                icon: r.icon,
                matcher: r.matcher,
                requires: r.requires,
            })),
        };
    });
}

/**
 * Apply plugin enable-state gates to the static sections. Currently: drops the
 * Gateway-section `/flow-editor` item when the flows plugin is explicitly
 * disabled. Returns new section/item arrays (does not mutate the input).
 */
export function gateSections(
    sections: Section[],
    enabledByPluginId: Record<string, boolean>,
): Section[] {
    if (isFlowsNavVisible(enabledByPluginId)) return sections;
    return sections.map((s) =>
        s.id === "gateway"
            ? { ...s, items: s.items.filter((it) => it.href !== "/flow-editor") }
            : s,
    );
}

export function findActiveSection(
    sections: Section[],
    pathname: string,
): Section | null {
    return (
        sections.find((s) => s.items.some((it) => it.matcher(pathname))) ?? null
    );
}

/**
 * Built-in plugin entries surfaced regardless of which gateway plugins are
 * installed. KANBAN is the hub-native paperclip integration (the /workforce
 * subtree) reframed as a standalone plugin. Each builtin carries the category
 * that decides which nav group it lands in.
 */
const BUILTIN_PLUGIN_ITEMS: Array<{ category: PluginNavCategory; item: SectionItem }> = [
    {
        category: "tool",
        item: {
            href: "/workforce",
            label: "Kanban",
            icon: FolderKanban,
            matcher: (p: string) => p.startsWith("/workforce"),
        },
    },
    {
        category: "tool",
        item: {
            href: "/crm",
            label: "CRM",
            icon: Contact,
            matcher: (p: string) => p.startsWith("/crm"),
        },
    },
];

type PluginNavCategory = "channel" | "automation" | "creative" | "tool" | "dashboard";

/**
 * Plugin nav groups, in display order. Plugins are bucketed by their manifest
 * `category` (channel plugins like whatsapp/telegram, automation like
 * alert-watcher, creative like studio, tools like kanban) so the sidebar no
 * longer dumps every plugin into one flat "Plugins" list. Unknown/absent
 * categories fall back to "tool".
 */
const PLUGIN_NAV_GROUPS: ReadonlyArray<{ category: PluginNavCategory; label: string }> = [
    { category: "channel", label: "Channels" },
    { category: "automation", label: "Automation" },
    { category: "creative", label: "Creative" },
    { category: "tool", label: "Tools" },
    { category: "dashboard", label: "Dashboards" },
];

function normalizePluginCategory(raw: string | undefined): PluginNavCategory {
    switch (raw) {
        case "channel":
        case "automation":
        case "creative":
        case "tool":
        case "dashboard":
            return raw;
        default:
            return "tool";
    }
}

/**
 * Build the plugin nav sections, one per non-empty category group (Channels,
 * Automation, Creative, Tools, Dashboards). Built-in entries (Kanban) and
 * installed plugin control centers are bucketed by category. Returns [] when
 * no group has any entries.
 */
export function getDynamicPluginsSections(
    entries: PluginUiManifestOccupant[],
): Section[] {
    const byCategory = new Map<PluginNavCategory, SectionItem[]>();
    const push = (category: PluginNavCategory, item: SectionItem) => {
        const list = byCategory.get(category) ?? [];
        list.push(item);
        byCategory.set(category, list);
    };

    for (const { category, item } of BUILTIN_PLUGIN_ITEMS) push(category, item);
    for (const e of entries) {
        push(normalizePluginCategory(e.category), {
            href: `/plugins/${e.pluginId}`,
            label: e.title,
            icon: resolvePluginIcon(e.icon),
            matcher: (p: string) => p.startsWith(`/plugins/${e.pluginId}`),
        });
    }

    const sections: Section[] = [];
    for (const group of PLUGIN_NAV_GROUPS) {
        const items = byCategory.get(group.category);
        if (!items || items.length === 0) continue;
        sections.push({
            id: `plugins:${group.category}`,
            label: group.label,
            icon: Puzzle,
            tone: "accent",
            domain: "gateway",
            items,
        });
    }
    return sections;
}
