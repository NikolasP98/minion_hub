/**
 * Marketing/acquisition funnel — pure helpers (no I/O, no paraglide) so this
 * module is shared by both the server (services, endpoints) and the client
 * (detail funnel, list column) and is unit-testable without SvelteKit aliases.
 *
 * This is a SEPARATE axis from the RFM lifecycle stage (New/Engaged/Active/…
 * in crm-format/crm-i18n). The funnel measures acquisition→conversion progress;
 * the lifecycle measures engagement recency. Labels live in crm-i18n.ts.
 *
 * The current stage is stored on `crm_contacts.custom_fields._funnel` (a
 * reserved, display-hidden key — see crm-meta.isReservedMetaKey). Auto-detection
 * only ADVANCES; manual override (by:'user') may set any stage.
 */

// 4-stage funnel: each stage maps to a REAL signal. The old 'interest' and
// 'consideration' stages had no data source (never auto-set, always 0%) and
// were collapsed away; 'intent' was generalised to the industry-agnostic
// 'opportunity' (showed buying intent — reserved/booked/quoted — but not yet
// purchased). Legacy stored values are remapped on read (see normalizeStage).
export type FunnelStage = 'lead' | 'opportunity' | 'customer' | 'loyal';

/** Ordered stage ids — index == funnel depth. */
export const FUNNEL_ORDER: FunnelStage[] = ['lead', 'opportunity', 'customer', 'loyal'];

/** Map a (possibly legacy 6-stage) id to the current funnel vocabulary. */
function normalizeStage(id: string): FunnelStage | null {
  if (id === 'interest' || id === 'consideration' || id === 'intent') return 'opportunity';
  return (FUNNEL_ORDER as string[]).includes(id) ? (id as FunnelStage) : null;
}

/** Per-stage accent (mirrors the StagePill `--c` pattern). */
const FUNNEL_COLORS: Record<FunnelStage, string> = {
  lead: '#64748b', // slate
  opportunity: '#f59e0b', // amber
  customer: '#10b981', // emerald
  loyal: '#eab308', // gold
};

/** The persisted funnel blob shape (lives under custom_fields._funnel). */
export interface FunnelMeta {
  stage: FunnelStage;
  /** true = set by detection/derivation; false = human-pinned. */
  auto: boolean;
  confidence?: number;
  reason?: string;
  analyzedAt?: string;
  updatedAt?: string;
}

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_ORDER as string[]).includes(v);
}

/** Accept a current OR legacy stage id, returning the normalized one (or null). */
export function coerceFunnelStage(v: unknown): FunnelStage | null {
  return typeof v === 'string' ? normalizeStage(v) : null;
}

export function funnelStageIndex(id: string): number {
  return FUNNEL_ORDER.indexOf(id as FunnelStage);
}

export function funnelStageColor(id: string): string {
  return FUNNEL_COLORS[id as FunnelStage] ?? 'var(--color-accent)';
}

/** Read the stored funnel blob from a contact's custom_fields (if valid). */
export function readFunnelMeta(
  customFields: Record<string, unknown> | null | undefined,
): FunnelMeta | null {
  const raw = customFields?.['_funnel'];
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const stage = coerceFunnelStage(obj.stage); // remap legacy interest/consideration/intent
  if (!stage) return null;
  return { auto: true, ...obj, stage } as FunnelMeta;
}

/**
 * Effective funnel stage for display:
 *  - the stored stage if present;
 *  - else baseline `lead` once there's a first inbound contact;
 *  - else `null` (a manual contact with no messages — nothing reached yet).
 */
export function effectiveFunnelStage(
  customFields: Record<string, unknown> | null | undefined,
  opts: { inbound: number },
): FunnelStage | null {
  const stored = readFunnelMeta(customFields);
  if (stored) return stored.stage;
  return opts.inbound > 0 ? 'lead' : null;
}

/** The deeper (further-along) of two funnel stages; nulls are ignored. */
export function maxFunnelStage(a: FunnelStage | null, b: FunnelStage | null): FunnelStage | null {
  if (!a) return b;
  if (!b) return a;
  return funnelStageIndex(a) >= funnelStageIndex(b) ? a : b;
}

/**
 * Finance-derived funnel FLOOR for a contact, from billing classification.
 * This is the additive CRM↔Finance bridge: when Finances is enabled, real
 * money advances the funnel (read-time, never persisted, so it stays decoupled
 * and reverts cleanly if the module is turned off).
 *  - a repeat procedure buyer → loyal
 *  - any procedure purchase → customer
 *  - only a reservation deposit (the "reservó pero no compró") → opportunity
 *  - nothing billable → null (funnel stays chat-driven)
 */
export interface FinanceClass {
  purchased: boolean;
  reservedOnly: boolean;
  loyal: boolean;
}
export function financeFloorStage(c: FinanceClass | null | undefined): FunnelStage | null {
  if (!c) return null;
  if (c.loyal) return 'loyal';
  if (c.purchased) return 'customer';
  if (c.reservedOnly) return 'opportunity';
  return null;
}
