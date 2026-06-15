/** Presentation helpers for CRM UI (pure, testable). */

/** Score (0–100) → a semantic color ramp: red (cold) → amber → green (hot). */
export function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)';
  if (score >= 50) return 'var(--color-emerald)';
  if (score >= 30) return 'var(--color-warning)';
  return 'var(--color-muted-foreground)';
}

/** Lifecycle stage → color, mirroring the journey progression. */
export function stageColor(stage: string): string {
  switch (stage) {
    case 'Active':
      return 'var(--color-success)';
    case 'Engaged':
      return 'var(--color-emerald)';
    case 'New':
      return 'var(--color-accent)';
    case 'Dormant':
      return 'var(--color-warning)';
    case 'Churned':
      return 'var(--color-destructive)';
    default:
      return 'var(--color-muted-foreground)';
  }
}

/** Compact relative time ("just now", "5m", "3h", "2d", "4w", "1y"). */
export function relativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d`;
  const w = d / 7;
  if (w < 52) return `${Math.round(w)}w`;
  return `${Math.round(d / 365)}y`;
}

/** A contact's display label, falling back through name → handle → "Unknown". */
export function contactLabel(displayName: string | null | undefined, fallback = 'Unknown'): string {
  const n = displayName?.trim();
  return n && n.length > 0 ? n : fallback;
}

/**
 * The ranking query coalesces a never-contacted recency to a 1e9-day sentinel
 * (so cold contacts sort last). Anything in that ballpark means "no contact on
 * record" — callers should render `crm_recency_never` rather than "1000000000.0d".
 */
const RECENCY_SENTINEL_DAYS = 100_000;
export function isRecencyNever(days: number | null | undefined): boolean {
  return days == null || !Number.isFinite(days) || days >= RECENCY_SENTINEL_DAYS;
}

/**
 * Present a contact identity's value: the channel-native IDENTIFIER (phone /
 * external id), NOT the friendly handle — the handle is usually the person's
 * name, which is already shown as the contact title. Phone-like ids are spaced
 * for readability ("+51924375271" → "+51 924 375 271").
 */
export function identityValue(externalId: string | null | undefined, handle?: string | null): string {
  const id = externalId?.trim();
  if (id && id.length > 0) return formatPhoneLike(id);
  const h = handle?.trim();
  return h && h.length > 0 ? h : '—';
}

/** Group a "+<digits>" phone-like string into readable triplets. Non-phone ids pass through. */
export function formatPhoneLike(value: string): string {
  if (!/^\+?\d{7,15}$/.test(value)) return value;
  const plus = value.startsWith('+');
  const digits = plus ? value.slice(1) : value;
  // Country code (first 1–3 digits) + remaining grouped in threes.
  const cc = digits.length > 9 ? digits.slice(0, digits.length - 9) : '';
  const rest = digits.slice(cc.length);
  const grouped = rest.replace(/(\d{3})(?=\d)/g, '$1 ');
  return `${plus ? '+' : ''}${cc}${cc ? ' ' : ''}${grouped}`.trim();
}
