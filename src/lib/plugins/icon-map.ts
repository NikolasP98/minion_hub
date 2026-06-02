import {
  Phone,
  Megaphone,
  BellRing,
  Puzzle,
  Palette,
  Image,
  GitBranch,
  Clock,
  Zap,
  MessageCircle,
  MessageSquare,
  Hash,
  Send,
} from "lucide-svelte";
import type { ComponentType, SvelteComponent } from "svelte";

// lucide-svelte still ships legacy SvelteComponentTyped types; widen for Svelte 5 mixed code.
export type LucideIcon = ComponentType<
  SvelteComponent<{ size?: number | string; class?: string }>
>;

/**
 * Brand identifiers that map to SVG icons (ChannelBrandIcon) rather than
 * lucide-svelte components. These are returned as strings so callers can
 * render the branded SVG where appropriate.
 */
export const BRAND_ICON_SET = new Set([
  "discord",
  "telegram",
  "whatsapp",
  "slack",
  "signal",
  "web",
  "imessage",
  "matrix",
  "msteams",
  "feishu",
  "googlechat",
  "irc",
  "line",
  "linq",
  "mattermost",
  "nextcloud-talk",
  "nostr",
  "tlon",
  "twitch",
  "wati",
  "weixin",
  "zalo",
  "zalouser",
  "bluebubbles",
]);

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
  Palette,
  Image,
  Puzzle,
  GitBranch,
  Clock,
  Zap,
  MessageCircle,
  MessageSquare,
  Hash,
  Send,
};

export function resolvePluginIcon(name?: string): LucideIcon | string {
  if (!name) return Puzzle;
  if (BRAND_ICON_SET.has(name)) return name;
  return PLUGIN_ICON_MAP[name] ?? Puzzle;
}
