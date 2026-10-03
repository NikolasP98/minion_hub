/** Encode a logical record ID once, at the URL boundary. Keep payload IDs raw. */
export function recordPathSegment(id: string | null | undefined): string {
  // URL parsers normalize whole dot segments even when their dots are escaped.
  if (typeof id !== 'string' || !id || id === '.' || id === '..')
    throw new TypeError('Invalid record identifier');
  return encodeURIComponent(id);
}

/** Invalid records render without an actionable parent/root destination. */
export function recordHref(base: string, id: string | null | undefined): string | undefined {
  try {
    return `${base}/${recordPathSegment(id)}`;
  } catch {
    return undefined;
  }
}
