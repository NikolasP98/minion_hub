import {
    Briefcase,
    Zap,
    Sparkles,
    LayoutDashboard,
    Users,
    User,
    BookOpen,
    GitBranch,
    Wrench,
    Store,
    Wand2,
    Paintbrush,
    Inbox,
    CheckCircle2,
    Target,
    FolderKanban,
    Puzzle,
} from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";
import * as m from "$lib/paraglide/messages";
import { resolvePluginIcon } from "$lib/plugins/icon-map";
import type { PluginUiManifestOccupant } from "$lib/plugins/PluginSlotHost.svelte";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
type LucideIcon = ComponentType<SvelteComponent<{ size?: number | string; class?: string }>>;

export type SectionTone = "accent" | "brand";

export type SectionItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    matcher: (path: string) => boolean;
};

export type Section = {
    id: "workforce" | "gateway" | "creative" | "plugins";
    label: string;
    icon: LucideIcon;
    tone: SectionTone;
    items: SectionItem[];
};

export function getSections(): Section[] {
    return [
        {
            id: "workforce",
            label: "Workforce",
            icon: Briefcase,
            tone: "accent",
            items: [
                {
                    href: "/workforce",
                    label: "Dashboard",
                    icon: LayoutDashboard,
                    matcher: (p) => p === "/workforce",
                },
                {
                    href: "/workforce/issues",
                    label: "Issues",
                    icon: Inbox,
                    matcher: (p) => p.startsWith("/workforce/issues"),
                },
                {
                    href: "/workforce/approvals",
                    label: "Approvals",
                    icon: CheckCircle2,
                    matcher: (p) => p.startsWith("/workforce/approvals"),
                },
                {
                    href: "/workforce/goals",
                    label: "Goals",
                    icon: Target,
                    matcher: (p) => p.startsWith("/workforce/goals"),
                },
                {
                    href: "/workforce/projects",
                    label: "Projects",
                    icon: FolderKanban,
                    matcher: (p) => p.startsWith("/workforce/projects"),
                },
                {
                    href: "/workforce/org",
                    label: "Org",
                    icon: Users,
                    matcher: (p) => p.startsWith("/workforce/org"),
                },
            ],
        },
        {
            id: "gateway",
            label: "Gateway",
            icon: Zap,
            tone: "accent",
            items: [
                {
                    href: "/my-agent",
                    label: m.nav_myAgent(),
                    icon: User,
                    matcher: (p) => p.startsWith("/my-agent"),
                },
                {
                    href: "/builder",
                    label: m.nav_builder(),
                    icon: BookOpen,
                    matcher: (p) => p.startsWith("/builder"),
                },
                {
                    href: "/flow-editor",
                    label: m.nav_flows(),
                    icon: GitBranch,
                    matcher: (p) => p.startsWith("/flow-editor"),
                },
                {
                    href: "/workshop",
                    label: m.nav_workshop(),
                    icon: Wrench,
                    matcher: (p) => p.startsWith("/workshop"),
                },
            ],
        },
        {
            id: "creative",
            label: "Creative",
            icon: Sparkles,
            tone: "brand",
            items: [
                {
                    href: "/marketplace",
                    label: m.nav_marketplace(),
                    icon: Store,
                    matcher: (p) => p.startsWith("/marketplace"),
                },
                {
                    href: "/prompt",
                    label: m.nav_prompt(),
                    icon: Wand2,
                    matcher: (p) => p.startsWith("/prompt"),
                },
                {
                    href: "/studio",
                    label: m.nav_studio(),
                    icon: Paintbrush,
                    matcher: (p) => p.startsWith("/studio"),
                },
            ],
        },
    ];
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
        items: entries.map((e) => ({
            href: `/plugins/${e.pluginId}`,
            label: e.title,
            icon: resolvePluginIcon(e.icon),
            matcher: (p: string) => p.startsWith(`/plugins/${e.pluginId}`),
        })),
    };
}
