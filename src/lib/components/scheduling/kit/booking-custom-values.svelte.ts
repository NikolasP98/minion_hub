/**
 * The org's own custom columns on appointments (`scheduling.bookings` in the
 * custom-property system) as ONE shared store a page and its views read:
 * definitions, per-booking values (fetched lazily, chunked at the API cap),
 * per-record edit rights, and a write that is optimistic per record and
 * re-reads on refusal. The calendar's subcolumns, the board's columns and the
 * table's custom cells all go through this, so a drop on one view is what the
 * next view shows.
 */
import {
  createCustomPropertyManagerActions,
  createCustomPropertyValueActions,
  CustomPropertyHttpError,
  loadCustomPropertyBundle,
  loadCustomPropertyDefinitions,
} from '$lib/components/data-table/custom-properties/api';
import type { MovePropertyWrite } from '../move-conflict';
import {
  CUSTOM_PROPERTY_QUERY_RECORDS_MAX,
  type CustomPropertyBundle,
  type CustomPropertyDefinition,
  type CustomPropertyValueCell,
} from '$lib/tables/custom-properties';

export const BOOKINGS_TABLE = 'scheduling.bookings' as const;
/** `subBy` / board-axis prefix for a custom column: `prop:<propertyId>`. */
export const PROP_PREFIX = 'prop:';

export interface BookingCustomValues {
  readonly defs: CustomPropertyDefinition[];
  /** Active select columns — the ones that can classify. */
  readonly selectDefs: CustomPropertyDefinition[];
  readonly canManage: boolean;
  readonly failed: boolean;
  readonly values: Record<string, Record<string, CustomPropertyValueCell>>;
  readonly editable: Record<string, boolean>;
  readonly managerActions: ReturnType<typeof createCustomPropertyManagerActions>;
  /** Definitions (+ manage right). Fail-soft: a viewer without the scheduling
   *  module simply has no custom columns. */
  load(): Promise<void>;
  setDefs(defs: CustomPropertyDefinition[]): void;
  upsertDef(def: CustomPropertyDefinition): void;
  /** Fetch values for the ids not asked for yet. */
  ensure(ids: readonly string[]): void;
  refetch(ids: readonly string[]): Promise<void>;
  /** The option id a booking holds for a select column, or null. */
  valueOf(bookingId: string, def: CustomPropertyDefinition): string | null;
  /** Write `value` (option id, or null to clear) to every id — one PUT per
   *  record, optimistic, re-read on refusal. Resolves with WHO landed: a
   *  caller must not take a resolved promise for "all written". */
  apply(
    def: CustomPropertyDefinition,
    ids: readonly string[],
    value: string | null,
  ): Promise<ApplyOutcome>;
  /** The writes a MOVE carries for these ids (HC-011): `value` for `def` on
   *  every id, each against the cell version this store last read. */
  writes(
    def: CustomPropertyDefinition,
    ids: readonly string[],
    value: string | null,
  ): MovePropertyWrite[];
  /** The `CustomPropertyBundle` shape `DataTable` consumes, over what is loaded. */
  bundle(): CustomPropertyBundle;
}

export interface ApplyOutcome {
  ok: string[];
  /** `reason` is the server's code (`version_conflict`, `record_unavailable`,
   *  …) or `network` when no response came back. */
  failed: { id: string; reason: string }[];
}

export function createBookingCustomValues(): BookingCustomValues {
  let defs = $state<CustomPropertyDefinition[]>([]);
  let canManage = $state(false);
  let canEdit = $state(false);
  let failed = $state(false);
  let values = $state<Record<string, Record<string, CustomPropertyValueCell>>>({});
  let editable = $state<Record<string, boolean>>({});
  const selectDefs = $derived(defs.filter((d) => d.type === 'select' && !d.archivedAt));
  const valueActions = createCustomPropertyValueActions(BOOKINGS_TABLE);
  const managerActions = createCustomPropertyManagerActions();
  const asked = new Set<string>();

  async function load() {
    try {
      // Active columns only: the archived list is a manage-level read, and a
      // staff viewer (scheduling view, no manage) was refused with a 403 and
      // saw no custom columns at all (owner report 2026-10-02).
      const r = await loadCustomPropertyDefinitions(BOOKINGS_TABLE, { includeArchived: false });
      defs = r.definitions;
      canManage = r.canManage;
      canEdit = r.canEdit;
      failed = false;
    } catch {
      defs = [];
      canManage = false;
      failed = true;
    }
  }
  async function refetch(ids: readonly string[]) {
    for (let i = 0; i < ids.length; i += CUSTOM_PROPERTY_QUERY_RECORDS_MAX) {
      const chunk = ids.slice(i, i + CUSTOM_PROPERTY_QUERY_RECORDS_MAX);
      const bundle = await loadCustomPropertyBundle(BOOKINGS_TABLE, [...chunk]);
      values = {
        ...values,
        ...Object.fromEntries(chunk.map((id) => [id, bundle.values[id] ?? {}])),
      };
      editable = {
        ...editable,
        ...Object.fromEntries(chunk.map((id) => [id, bundle.recordAccess[id]?.canEdit ?? false])),
      };
    }
  }
  function ensure(ids: readonly string[]) {
    const missing = [...new Set(ids.filter((id) => !asked.has(id)))];
    if (!missing.length) return;
    for (const id of missing) asked.add(id);
    void refetch(missing).catch(() => {
      for (const id of missing) asked.delete(id);
    });
  }
  function valueOf(bookingId: string, def: CustomPropertyDefinition): string | null {
    const v = values[bookingId]?.[def.id]?.effectiveValue;
    if (typeof v !== 'string' || def.rules.type !== 'select') return null;
    return def.rules.options.some((o) => o.id === v && !o.archivedAt) ? v : null;
  }
  function writes(
    def: CustomPropertyDefinition,
    ids: readonly string[],
    value: string | null,
  ): MovePropertyWrite[] {
    return ids.map((id) => ({
      propertyId: def.id,
      recordId: id,
      value,
      expectedVersion: values[id]?.[def.id]?.version ?? 0,
    }));
  }
  async function apply(
    def: CustomPropertyDefinition,
    ids: readonly string[],
    value: string | null,
  ): Promise<ApplyOutcome> {
    const now = new Date().toISOString();
    const prev = values;
    values = {
      ...values,
      ...Object.fromEntries(
        ids.map((id) => [
          id,
          {
            ...(values[id] ?? {}),
            [def.id]: {
              propertyId: def.id,
              recordId: id,
              present: value !== null,
              value,
              effectiveValue: value,
              version: values[id]?.[def.id]?.version ?? 0,
              updatedAt: now,
            },
          },
        ]),
      ),
    };
    const outcome: ApplyOutcome = { ok: [], failed: [] };
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { cell } = await valueActions.save(
            def,
            id,
            value,
            prev[id]?.[def.id]?.version ?? 0,
          );
          values = { ...values, [id]: { ...(values[id] ?? {}), [def.id]: cell } };
          outcome.ok.push(id);
        } catch (e) {
          outcome.failed.push({
            id,
            reason: e instanceof CustomPropertyHttpError ? e.code : 'network',
          });
        }
      }),
    );
    if (outcome.failed.length) await refetch(outcome.failed.map((f) => f.id)).catch(() => {});
    return outcome;
  }

  return {
    get defs() {
      return defs;
    },
    get selectDefs() {
      return selectDefs;
    },
    get canManage() {
      return canManage;
    },
    get failed() {
      return failed;
    },
    get values() {
      return values;
    },
    get editable() {
      return editable;
    },
    managerActions,
    load,
    setDefs: (next) => (defs = next),
    upsertDef: (def) =>
      (defs = defs.some((x) => x.id === def.id)
        ? defs.map((x) => (x.id === def.id ? def : x))
        : [...defs, def]),
    ensure,
    refetch,
    valueOf,
    apply,
    writes,
    bundle: () => ({
      definitions: defs.filter((d) => !d.archivedAt),
      values,
      recordAccess: Object.fromEntries(
        Object.entries(editable).map(([id, e]) => [id, { canEdit: e }]),
      ),
      canManage,
      canEdit,
    }),
  };
}
