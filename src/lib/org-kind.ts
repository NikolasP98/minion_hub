/**
 * Single source of truth for "what changes when an org is personal vs
 * business". Pure TS, no Svelte — see specs/2026-07-19-org-kind-segregation-spec.md.
 * Add a new per-kind rule here, not as a scattered `if (kind === 'personal')`.
 */
export type OrgKind = 'business' | 'personal';

export const ORG_KIND_POLICY = {
  business: { hiddenModules: new Set<string>(['pulse']), label: 'Business' },
  personal: { hiddenModules: new Set<string>(['pos', 'stock', 'workforce']), label: 'Personal' },
} as const;

/** Unknown/undefined kind degrades to 'business' — matches the DB default. */
export function isModuleVisibleForKind(moduleId: string, kind: OrgKind | undefined | null): boolean {
  const resolved: OrgKind = kind === 'personal' ? 'personal' : 'business';
  return !ORG_KIND_POLICY[resolved].hiddenModules.has(moduleId);
}
