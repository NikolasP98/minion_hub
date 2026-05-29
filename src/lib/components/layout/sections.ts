import { Puzzle } from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";
import { resolvePluginIcon } from "$lib/plugins/icon-map";
import type { PluginUiManifestOccupant } from "$lib/plugins/PluginSlotHost.svelte";
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

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
type LucideIcon = ComponentType<SvelteComponent<{ size?: number | string; class?: string }>>;

export type { SectionTone, NavDomain };
export { DOMAIN_LABEL };

export type SectionItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    matcher: (path: string) => boolean;
    // Optional access-policy key (see $lib/access/policy). When set, the nav
    // item is only rendered for users who satisfy it (admin-only "plugin"
    // views). Filtered in the sidebar via canClient(); routes are also guarded
    // server-side, so hiding here is UX only.
    requires?: string;
};

export type Section = {
    id: SectionId | "plugins";
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
 * Build a dynamic "Plugins" section from the list of installed plugin
 * control centers. Returns null when no plugin opts in, so the Browse-menu
 * column can be hidden until at least one entry is available.
 */
export function getDynamicPluginsSection(
    entries: PluginUiManifestOccupant[],
): Section | null {
    if (entries.length === 0) return null;
    return {
        id: "plugins",
        label: "Plugins",
        icon: Puzzle,
        tone: "accent",
        domain: "gateway",
        items: entries.map((e) => ({
            href: `/plugins/${e.pluginId}`,
            label: e.title,
            icon: resolvePluginIcon(e.icon),
            matcher: (p: string) => p.startsWith(`/plugins/${e.pluginId}`),
        })),
    };
}
