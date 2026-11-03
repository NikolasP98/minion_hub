/**
 * Server half of the module SDK (spec 047): what a module owns that must not
 * reach the browser — its sandbox datasets (raw SQL identifiers) and the
 * cross-module links between its tables and other modules' tables.
 * `DATASETS` derives its entries for a migrated module from here.
 */
import type { ModuleDefinition } from '$lib/modules/sdk';
import type { ColumnType, Dataset, DatasetColumn } from '$server/sandbox/datasets';

/**
 * A column of one module's table that points at another module's table,
 * `table.column` → `table.column`. `soft: true` = no foreign key by design
 * (the cross-module convention in the stock migrations: "soft ref → …");
 * links.sql.integration.test.ts checks both kinds against the live catalog.
 */
export interface ModuleLink {
  from: string;
  to: string;
  soft?: true;
}

export interface ServerModuleDefinition {
  /** The module's facts (`<id>/facts.ts`); not the full definition, whose table labels pull in paraglide. */
  module: Omit<ModuleDefinition, 'tables'>;
  datasets: readonly Dataset[];
  links: readonly ModuleLink[];
}

export function defineServerModule(d: ServerModuleDefinition): ServerModuleDefinition {
  return d;
}

/** `DATASETS` entries for `mods`, in definition order. */
export function datasetsFrom(mods: readonly ServerModuleDefinition[]): Dataset[] {
  return mods.flatMap((d) => d.datasets);
}

/** Dataset column helper (was private to sandbox/datasets.ts). */
export function col(
  name: string,
  type: ColumnType,
  meaning: string,
  extra: { pii?: boolean; expr?: string } = {},
): DatasetColumn {
  return { name, type, meaning, ...extra };
}
