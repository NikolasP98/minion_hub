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
