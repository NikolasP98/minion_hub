/** Reconcile saved IDs without changing a viewer's deliberate order. New IDs append. */
export function catalogIds(
  value: unknown,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): string[] {
  const known = new Set(catalog);
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => (Object.hasOwn(aliases, id) ? aliases[id] : id))
        .filter((id) => known.has(id)),
    ),
  ];
}
export function layoutRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.version === undefined || record.version === 0 || record.version === 1
    ? record
    : null;
}
