/**
 * Pure hidden-field logic for the item detail "Overview" card (spec
 * 2026-09-28 Bundle C #1). Visibility is per USER (`preferences.recordOverview`)
 * layered over the org's `/settings/tables` field config — org-hidden fields
 * never render regardless of the user's own toggle.
 */
export interface OverviewProperty {
  key: string;
  label: string;
}

/** `all` filtered to fields neither the org nor this user has hidden. Order
 *  is preserved from `all` (facts first, then custom properties). */
export function visibleProperties(
  all: OverviewProperty[],
  orgHidden: ReadonlySet<string>,
  userHidden: ReadonlySet<string>,
): OverviewProperty[] {
  return all.filter((p) => !orgHidden.has(p.key) && !userHidden.has(p.key));
}

/** Toggle `key` in/out of the user's hidden-keys list. */
export function toggleHidden(hidden: readonly string[], key: string): string[] {
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
}
