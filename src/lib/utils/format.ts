import { languageTag } from '$lib/paraglide/runtime';

/**
 * Human-readable byte formatter per Phase 20 CONTEXT specifics: `523 B`, `2.3 KB`,
 * `14.1 KB`, `1.2 MB`. Used by PreviewPanel totals + breakdown.
 */
export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Token count formatter per Phase 20 CONTEXT specifics: `1,234 tokens` with
 * thousands separator, no unit compaction. Used by PreviewPanel.
 */
export function formatTokens(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${v.toLocaleString('en-US')} tokens`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (!n || n === 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function fmtTimeAgo(ts: number | null | undefined): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtUptime(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

const MONEY_SYMBOL: Record<string, string> = { PEN: 'S/', USD: '$', EUR: '€' };

/**
 * Canonical money formatter. FACES is PEN → "S/ 1,234.00". Currency-aware so a
 * row carrying its own currency (fin_invoices.currency, etc.) renders correctly;
 * defaults to PEN (the org currency) when none is given. This is the ONE money
 * formatter for the app — every price/total/amount surface routes through it
 * instead of hand-rolling toLocaleString/toFixed with no symbol.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string = 'PEN',
  opts: { compact?: boolean; decimals?: number } = {},
): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? NaN);
  if (!Number.isFinite(n)) return '—';
  const cur = (currency || 'PEN').toUpperCase();
  const maximumFractionDigits = opts.decimals ?? (opts.compact ? 0 : 2);
  const minimumFractionDigits = Math.min(
    opts.compact ? 0 : maximumFractionDigits,
    maximumFractionDigits,
  );
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: cur,
      notation: opts.compact ? 'compact' : 'standard',
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(n as number);
  } catch {
    // Unknown/invalid ISO code → symbol map + plain number.
    const sym = MONEY_SYMBOL[cur] ?? `${cur} `;
    return `${sym} ${(n as number).toLocaleString('es-PE', { minimumFractionDigits, maximumFractionDigits })}`;
  }
}

/** Compact money for dense chart axes / KPIs: "S/ 1.2M". */
export function formatMoneyShort(
  value: number | string | null | undefined,
  currency: string = 'PEN',
): string {
  return formatMoney(value, currency, { compact: true });
}

export function truncKey(key: string | null | undefined, max = 28): string {
  if (!key) return '';
  return key.length > max ? key.slice(0, max) + '\u2026' : key;
}

export function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Canonical date/time label formatter. The locale is the ACTIVE PARAGLIDE one,
 * never the browser's: `toLocaleDateString(undefined, …)` renders "Mon Sep 7"
 * inside a fully Spanish UI whenever the OS is English, which is exactly what
 * the scheduling calendar shipped. Same rule as `formatMoney` — one formatter,
 * every surface routes through it.
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(languageTag() === 'es' ? 'es-PE' : 'en-US', opts).format(d);
}

/**
 * 24-hour clock label ("09:00"), locale-pinned exactly like `formatDate`. The
 * scheduling calendar's time axis is 24-hour, so the chips sitting on it must be
 * too — `toLocaleTimeString(undefined, …)` rendered "09:00 AM" against an "09:00"
 * gutter, and asked the BROWSER for the locale on top of that.
 */
export function formatTime(value: Date | string | number | null | undefined): string {
  return formatDate(value, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Short weekday names indexed 0=Sun..6=Sat — the `AvailabilityRule.days`
 * convention (`src/server/scheduling/slots.ts`) that the weekly hours editor
 * indexes by. 2024-01-07 was a Sunday, so `+i` walks one week from it; LOCAL
 * midnights, so a negative-offset zone can't roll a label back a day.
 * Call from a `$derived`, never module scope — module scope SSR-bakes one locale.
 */
export function weekdayLabels(): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    formatDate(new Date(2024, 0, 7 + i), { weekday: 'short' }),
  );
}
