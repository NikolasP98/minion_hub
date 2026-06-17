/** Rewind a watermark by `overlapMs` so edge-of-window modifications aren't missed. */
export function overlapSince(watermark: string | null, overlapMs = 5 * 60 * 1000): string | undefined {
  if (!watermark) return undefined;
  const t = Date.parse(watermark);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t - overlapMs).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}
