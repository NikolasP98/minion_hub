/**
 * Official module SDK (spec 047, meta `specs/047-hub-module-sdk-install-packages/`).
 * One `defineModule({...})` object describes a module's client-safe facts; the
 * hand-kept registries (`MODULE_MANIFEST`, `TABLE_REGISTRY`) derive their
 * entries for it from here. Server-only facts (datasets, cross-module links)
 * live in the companion `$server/modules/<id>.server.ts`.
 *
 * Client-safe: type-only imports, no server code.
 */
import type { OrgKind } from '$lib/org-kind';
import type { TableDef } from '$lib/tables/registry';
import type { ModuleAvailability } from './availability';

export interface ModuleDefinition {
  id: string;
  appPrefixes: readonly string[];
  toggleId?: string;
  kinds?: readonly OrgKind[];
  requires?: readonly string[];
  tables: readonly TableDef[];
}

export function defineModule<const T extends ModuleDefinition>(d: T): T {
  return d;
}

/**
 * The availability half of a definition (no tables). `MODULE_MANIFEST` is read
 * by the hooks and many server services, so it must not import the tables'
 * paraglide labels (`messages.js` is ~6 MB): a module keeps its facts in
 * `<id>/facts.ts` and its `index.ts` spreads them into the full definition.
 */
export type ModuleFacts = Omit<ModuleDefinition, 'tables'> & { tables?: never };

export function defineModuleFacts<const T extends ModuleFacts>(d: T): T {
  return d;
}

/** `MODULE_MANIFEST` entries for `mods`, keyed by literal id (so `ModuleId` stays a literal union). */
export function manifestFrom<const M extends readonly ModuleFacts[]>(
  mods: M,
): { [K in M[number]['id']]: ModuleAvailability } {
  return Object.fromEntries(mods.map(({ id, ...availability }) => [id, availability])) as {
    [K in M[number]['id']]: ModuleAvailability;
  };
}

/** `TABLE_REGISTRY` entries for `mods`, in definition order. */
export function tablesFrom(mods: readonly ModuleDefinition[]): TableDef[] {
  return mods.flatMap((d) => d.tables);
}
