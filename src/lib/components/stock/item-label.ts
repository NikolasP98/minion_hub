/** Name first, code second: a truncated label then loses the code, not the
 *  word that tells two similar supplies apart (meta spec 130). */
export function itemLabel(
  item: { name: string; code?: string | null } | undefined,
  fallback: string,
): string {
  if (!item) return fallback;
  return item.code ? `${item.name} · ${item.code}` : item.name;
}
