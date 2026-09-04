export type TeamTab = 'people' | 'timeoff' | 'resources' | 'settings';

/** Pre-fold tab values (bookmarks, assistant links) still resolve. */
const LEGACY: Record<string, TeamTab> = {
  roster: 'people',
  availability: 'people',
  members: 'people',
  holidays: 'settings',
};

/** `?tab=` is the source of truth; unknown/missing (or settings without rights) falls back to People. */
export function resolveTeamTab(q: string | null, canConfigure: boolean): TeamTab {
  const v = (q && LEGACY[q]) || q;
  if (v === 'settings') return canConfigure ? 'settings' : 'people';
  return v === 'timeoff' || v === 'resources' ? v : 'people';
}
