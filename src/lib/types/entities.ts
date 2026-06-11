/**
 * Standardized entity references.
 *
 * A single canonical shape — `EntityRef` — for every "thing" in the org graph
 * (org, area, agent, skill, tool, user) so any of them can be:
 *   1. rendered inline inside a sentence with a small icon (`<EntityChip>`), and
 *   2. dropped into the OVERVIEW graph as a node.
 *
 * Builders (`orgRef`, `areaRef`, `agentRef`, `userRef`, `skillRef`) convert the
 * existing service/state types into this shape so callers don't reach into the
 * raw rows. Icons are resolved by lucide-svelte component name (`icon`) for
 * abstract entities, or by avatar image URL (`imageUrl`) for agents/users.
 */
import {
  Building2,
  Users,
  Bot,
  Sparkles,
  Wrench,
  User,
  TrendingUp,
  Megaphone,
  Settings2,
  Code2,
  LifeBuoy,
  Headphones,
  ShoppingCart,
  Banknote,
  Scale,
  FlaskConical,
  Boxes,
  HeartHandshake,
  Palette,
  ShieldCheck,
  Network,
} from 'lucide-svelte';
import type { LucideIcon } from '$lib/nav/routes';
import { diceBearAvatarUrl } from '$lib/utils/avatar';

export type EntityKind = 'org' | 'area' | 'agent' | 'skill' | 'tool' | 'user';

export interface EntityRef {
  kind: EntityKind;
  /** Stable id (org/area/user uuid, agent/skill string id). */
  id: string;
  /** Human label shown in the chip / graph node. */
  label: string;
  /** Avatar/logo image URL (users, agents). Takes precedence over `icon`. */
  imageUrl?: string | null;
  /** lucide-svelte icon component NAME (org, area, skill, tool). */
  icon?: string | null;
  /** Accent color (hex or css var). Drives chip tint + node color. */
  color?: string | null;
  /** Optional navigation target. */
  href?: string | null;
}

/** Curated icon registry — the only icon names an area / entity may use. */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Building2,
  Users,
  Bot,
  Sparkles,
  Wrench,
  User,
  Network,
  TrendingUp,
  Megaphone,
  Settings2,
  Code2,
  LifeBuoy,
  Headphones,
  ShoppingCart,
  Banknote,
  Scale,
  FlaskConical,
  Boxes,
  HeartHandshake,
  Palette,
  ShieldCheck,
} as unknown as Record<string, LucideIcon>;

/** Icon names offered in the area editor's icon picker. */
export const AREA_ICON_KEYS: string[] = [
  'Building2',
  'TrendingUp',
  'Megaphone',
  'Settings2',
  'Code2',
  'LifeBuoy',
  'Headphones',
  'ShoppingCart',
  'Banknote',
  'Scale',
  'FlaskConical',
  'Boxes',
  'HeartHandshake',
  'Palette',
  'ShieldCheck',
  'Network',
];

/** Color swatches offered in the area editor. */
export const AREA_COLORS: string[] = [
  '#6366f1',
  '#22c55e',
  '#ec4899',
  '#f59e0b',
  '#3b82f6',
  '#06b6d4',
  '#a855f7',
  '#ef4444',
  '#10b981',
  '#eab308',
];

/** Default lucide icon component per kind (fallback when `icon` is unset). */
const KIND_ICON: Record<EntityKind, LucideIcon> = {
  org: Building2 as unknown as LucideIcon,
  area: Users as unknown as LucideIcon,
  agent: Bot as unknown as LucideIcon,
  skill: Sparkles as unknown as LucideIcon,
  tool: Wrench as unknown as LucideIcon,
  user: User as unknown as LucideIcon,
};

/** Default CSS-token color per kind. */
export const KIND_COLOR: Record<EntityKind, string> = {
  org: 'var(--color-foreground)',
  area: 'var(--color-accent)',
  agent: 'var(--color-cyan)',
  skill: 'var(--color-brand-pink)',
  tool: 'var(--color-warning)',
  user: 'var(--color-success)',
};

/** Resolve the lucide component for an entity ref (named icon → kind default). */
export function resolveIcon(ref: Pick<EntityRef, 'kind' | 'icon'>): LucideIcon {
  if (ref.icon && ICON_REGISTRY[ref.icon]) return ICON_REGISTRY[ref.icon];
  return KIND_ICON[ref.kind];
}

/** Resolve a lucide component directly by registry name. */
export function iconByName(name: string | null | undefined): LucideIcon | null {
  if (name && ICON_REGISTRY[name]) return ICON_REGISTRY[name];
  return null;
}

// ── Builders ─────────────────────────────────────────────────────────────────

export function orgRef(org: { id: string; name: string }): EntityRef {
  return { kind: 'org', id: org.id, label: org.name, icon: 'Building2', color: KIND_COLOR.org };
}

export function areaRef(area: {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}): EntityRef {
  return {
    kind: 'area',
    id: area.id,
    label: area.name,
    icon: area.icon ?? 'Users',
    color: area.color ?? KIND_COLOR.area,
  };
}

export function agentRef(agent: { id: string; name?: string | null }): EntityRef {
  return {
    kind: 'agent',
    id: agent.id,
    label: agent.name ?? agent.id,
    imageUrl: diceBearAvatarUrl(agent.id),
    color: KIND_COLOR.agent,
  };
}

export function userRef(user: {
  id: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}): EntityRef {
  const label = user.displayName ?? user.email ?? 'User';
  return {
    kind: 'user',
    id: user.id,
    label,
    imageUrl: user.avatarUrl ?? diceBearAvatarUrl(user.id),
    color: KIND_COLOR.user,
  };
}

export function skillRef(skill: { key: string; label?: string | null }): EntityRef {
  return {
    kind: 'skill',
    id: skill.key,
    label: skill.label ?? skill.key,
    icon: 'Sparkles',
    color: KIND_COLOR.skill,
  };
}

// ── Integrations ─────────────────────────────────────────────────────────────

/**
 * Branded third-party platforms an area's skills/agents operate through (Meta
 * Ads, Instagram, Google Sheets, …). `slug` keys into the Simple Icons CDN —
 * `https://cdn.simpleicons.org/<slug>` returns the official brand-colored SVG,
 * which the OVERVIEW graph renders as the integrations ring.
 */
export interface IntegrationDef {
  key: string;
  name: string;
  slug: string;
  /** Official brand color (hex) — used for edges/chips around the logo. */
  color: string;
}

export const INTEGRATIONS: Record<string, IntegrationDef> = {
  meta: { key: 'meta', name: 'Meta Ads', slug: 'meta', color: '#0467DF' },
  instagram: { key: 'instagram', name: 'Instagram', slug: 'instagram', color: '#FF0069' },
  facebook: { key: 'facebook', name: 'Facebook', slug: 'facebook', color: '#0866FF' },
  whatsapp: { key: 'whatsapp', name: 'WhatsApp', slug: 'whatsapp', color: '#25D366' },
  googleanalytics: {
    key: 'googleanalytics',
    name: 'Google Analytics',
    slug: 'googleanalytics',
    color: '#E37400',
  },
  googlecalendar: {
    key: 'googlecalendar',
    name: 'Google Calendar',
    slug: 'googlecalendar',
    color: '#4285F4',
  },
  googlesheets: {
    key: 'googlesheets',
    name: 'Google Sheets',
    slug: 'googlesheets',
    color: '#34A853',
  },
  googledrive: { key: 'googledrive', name: 'Google Drive', slug: 'googledrive', color: '#4285F4' },
  notion: { key: 'notion', name: 'Notion', slug: 'notion', color: '#a8a8a8' },
  figma: { key: 'figma', name: 'Figma', slug: 'figma', color: '#F24E1E' },
  mailchimp: { key: 'mailchimp', name: 'Mailchimp', slug: 'mailchimp', color: '#FFE01B' },
  stripe: { key: 'stripe', name: 'Stripe', slug: 'stripe', color: '#635BFF' },
};

/** Brand-logo image URL for an integration key (Simple Icons CDN). */
export function integrationIconUrl(key: string): string | null {
  const def = INTEGRATIONS[key];
  return def ? `https://cdn.simpleicons.org/${def.slug}` : null;
}
