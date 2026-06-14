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
