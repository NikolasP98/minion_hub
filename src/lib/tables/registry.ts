/**
 * Table registry — the static catalogue of every user-facing DataTable
 * (owner directive 2026-09-21): each gets an ID column with a configurable
 * prefix over the entity's HUMAN code (never the UUID; the core value is never
 * editable) and a Title column that links into the record. Owners tune the
 * prefix and every field's label / default visibility / editability per
 * organization on /settings/tables; the config document lives in
 * `app_table_config` (see table-config.service.ts) and reaches every table
 * through `page.data.tableConfig` (config.svelte.ts).
 *
 * Adding a table = one def file under ./defs + the `tableId` prop on its
 * DataTable. Field labels are the SAME message functions the page's columns
 * use, so the settings page and the header always agree.
 */

export interface TableFieldDef {
  key: string;
  /** Default column label (locale-aware, so a function). */
  label: () => string;
  /** The code allows inline editing of this field; owners may switch it off. */
  editable?: boolean;
}

export interface TableDef {
  /** `<module>.<table>` — the settings page groups by the module part. */
  id: string;
  module: string;
  label: () => string;
  /** Default prefix for the ID column; '' = the bare code. */
  idPrefix: string;
  /** No human code yet (UUID-only entity): no ID column until part 2 numbers it. */
  hasId: boolean;
  fields: TableFieldDef[];
}

/** Per-field overrides an owner may store. `editable` can only be switched OFF. */
export interface TableFieldConfig {
  label?: string;
  /** `null` clears a stored override (reset). */
  hidden?: boolean | null;
  /** `false` switches a code-editable field off; `true` (or absent) restores the default. */
  editable?: boolean;
}
export interface TableEntryConfig {
  idPrefix?: string;
  fields?: Record<string, TableFieldConfig>;
}
/** The whole org document: table id → overrides. */
export type TableConfig = Record<string, TableEntryConfig>;

export const ID_PREFIX_MAX = 12;
export const FIELD_LABEL_MAX = 40;

/** Effective settings for one table = registry defaults ⊕ org overrides. */
export interface ResolvedTable {
  def: TableDef;
  idPrefix: string;
  /** `editable` = the owner has NOT switched it off (the column's own flag still rules). */
  fields: Map<string, { label: string; hidden: boolean | undefined; editable: boolean }>;
}

export function resolveTable(def: TableDef, config: TableConfig | null | undefined): ResolvedTable {
  const entry = config?.[def.id];
  const fields = new Map<
    string,
    { label: string; hidden: boolean | undefined; editable: boolean }
  >();
  for (const f of def.fields) {
    const o = entry?.fields?.[f.key];
    fields.set(f.key, {
      label: o?.label?.trim() ? o.label.trim() : f.label(),
      hidden: o?.hidden ?? undefined,
      editable: o?.editable !== false,
    });
  }
  return { def, idPrefix: entry?.idPrefix ?? def.idPrefix, fields };
}

/** `ITM-` + `1261` → `ITM-1261`; an empty code renders nothing (no dangling prefix). */
export function formatId(prefix: string, code: string | number | null | undefined): string {
  const c = code == null ? '' : String(code).trim();
  return c ? `${prefix}${c}` : '';
}

/**
 * Deep-merge a patch into the document, dropping overrides that equal the
 * registry default so the stored document only ever holds real customisation.
 */
export function applyTablePatch(
  current: TableConfig,
  defs: readonly TableDef[],
  patch: TableConfig,
): TableConfig {
  const next: TableConfig = structuredClone(current);
  for (const [id, p] of Object.entries(patch)) {
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    const entry: TableEntryConfig = { ...(next[id] ?? {}) };
    if (p.idPrefix !== undefined) {
      const v = p.idPrefix.trim().slice(0, ID_PREFIX_MAX);
      if (v === def.idPrefix) delete entry.idPrefix;
      else entry.idPrefix = v;
    }
    if (p.fields) {
      const fields = { ...(entry.fields ?? {}) };
      for (const [key, fp] of Object.entries(p.fields)) {
        const fdef = def.fields.find((f) => f.key === key);
        if (!fdef) continue;
        const cur: TableFieldConfig = { ...(fields[key] ?? {}) };
        if (fp.label !== undefined) {
          const v = fp.label.trim().slice(0, FIELD_LABEL_MAX);
          if (!v || v === fdef.label()) delete cur.label;
          else cur.label = v;
        }
        if (fp.hidden !== undefined) {
          if (fp.hidden === null) delete cur.hidden;
          else cur.hidden = fp.hidden;
        }
        if (fp.editable !== undefined) {
          if (fp.editable === false && fdef.editable) cur.editable = false;
          else delete cur.editable;
        }
        if (Object.keys(cur).length) fields[key] = cur;
        else delete fields[key];
      }
      if (Object.keys(fields).length) entry.fields = fields;
      else delete entry.fields;
    }
    if (Object.keys(entry).length) next[id] = entry;
    else delete next[id];
  }
  return next;
}
