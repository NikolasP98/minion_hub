import { Phone, Megaphone, BellRing, Puzzle } from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
export type LucideIcon = ComponentType<
  SvelteComponent<{ size?: number | string; class?: string }>
>;

/**
 * Plugin manifests can name a lucide-svelte icon as a string. This map
 * resolves the known set; unknown strings fall back to Puzzle. Emoji icons
 * are handled inline at the call site via Extended_Pictographic regex.
 */
export const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  Phone,
  Megaphone,
  MegaphoneSimple: Megaphone,
  BellRing,
  Puzzle,
};

export function resolvePluginIcon(name?: string): LucideIcon {
  if (!name) return Puzzle;
  return PLUGIN_ICON_MAP[name] ?? Puzzle;
}
