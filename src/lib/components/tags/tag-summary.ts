/** Pure "N shown + extra" truncation for dense tag-dot lists (e.g. the
 *  `/crm/customers` Tags column). No DOM, no component — just the split. */
export function summarizeTags<T>(tags: T[], max = 3): { shown: T[]; extra: number } {
  return { shown: tags.slice(0, max), extra: Math.max(0, tags.length - max) };
}
