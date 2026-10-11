/**
 * The org's custom properties as `DataTable` columns. Lives outside
 * `DataTable.svelte` because a page that filters a SECOND view of the same
 * rows (the appointments calendar/board) has to resolve the very same column
 * keys, kinds, options and match functions the table resolves, or a
 * `custom:<id>` filter would select different rows in each view.
 *
 * Sort and export values stay with the table (they need its comparator and
 * the viewer's locale), so this returns the column plus the definition and
 * value getter the caller needs to add them.
 */
import type { DataColumn, CellType } from '../DataTable.svelte';
import { primaryFormulaVariable } from '$lib/tables/formula';
import {
  customPropertyColumnKey,
  type CustomPropertyBundle,
  type CustomPropertyDefinition,
  type CustomPropertyValue,
} from '$lib/tables/custom-properties';

export interface CustomPropertyColumn<T> {
  definition: CustomPropertyDefinition;
  column: DataColumn<T>;
  /** The record's effective value for this property (null when unset). */
  value: (row: T) => CustomPropertyValue | null;
}

/**
 * One column per ACTIVE definition in `bundle`, in bundle order.
 * `server` tables have no local sort/filter/export over custom values yet
 * (meta proposal 2026-09-26-hub-custom-columns-next-phases).
 */
export function customPropertyColumns<T>(
  bundle: CustomPropertyBundle,
  recordId: (row: T) => string | null,
  opts: { server?: boolean } = {},
): CustomPropertyColumn<T>[] {
  const server = !!opts.server;
  return bundle.definitions
    .filter((definition) => !definition.archivedAt)
    .map((definition): CustomPropertyColumn<T> => {
      const rules = definition.rules;
      const primaryFormula =
        rules.type === 'formula' ? primaryFormulaVariable(rules, definition.id) : null;
      const columnType: CellType =
        rules.type === 'formula'
          ? primaryFormula!.outputType.kind
          : rules.type === 'multi_select'
            ? 'text'
            : rules.type;
      const value = (row: T): CustomPropertyValue | null => {
        const id = recordId(row);
        return id ? (bundle.values[id]?.[definition.id]?.effectiveValue ?? null) : null;
      };
      const options =
        definition.type === 'select' || definition.type === 'multi_select'
          ? () => {
              if (rules.type !== 'select' && rules.type !== 'multi_select') return [];
              return rules.options
                .filter((option) => !option.archivedAt)
                .map((option) => ({ value: option.id, label: option.label }));
            }
          : undefined;
      return {
        definition,
        value,
        column: {
          key: customPropertyColumnKey(definition.id),
          label: definition.label,
          accessor: value,
          custom: true,
          customEditable: definition.type !== 'formula',
          type: columnType,
          numeric: definition.type === 'number' || primaryFormula?.outputType.kind === 'number',
          sortable: !server,
          filter:
            !server && options
              ? {
                  options,
                  match: (row: T) => {
                    const current = value(row);
                    return Array.isArray(current)
                      ? current
                      : typeof current === 'string'
                        ? current
                        : null;
                  },
                }
              : undefined,
          exportable: !server,
          width: 176,
        },
      };
    });
}
