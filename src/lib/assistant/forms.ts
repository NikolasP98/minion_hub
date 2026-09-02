/**
 * Form registry: a mounted form describes its fields once and gets a
 * `fill_<id>` tool (WebMCP-shaped) for as long as it is on screen.
 *
 * The page keeps ownership of its state — `set` writes into the page's own
 * $state, the user still presses Submit. The assistant never submits.
 *
 * `FORM_CATALOG` (static, same field defs) lets the model plan
 * navigate + fill in one reply before the form has mounted; the runner waits
 * for the tool to register after navigation.
 */
import { registerTool, type JsonSchema } from './model-context';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea' | 'entity';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Plain-language meaning, shown to the model so it can explain the field. */
  description?: string;
  /** For `select`: allowed values (value → label). */
  options?: Array<{ value: string; label: string }>;
  /** For `entity`: what the value refers to (e.g. "stock item name or SKU"). */
  entity?: string;
}

export interface FormDef {
  /** Stable id, `[a-z0-9_]+`, e.g. `stock_entry`. */
  id: string;
  title: string;
  /** What submitting this form does. */
  description: string;
  /** Route where the form lives + query that opens it (e.g. `{ new: '1' }`). */
  route: string;
  open?: Record<string, string>;
  fields: FormField[];
  /** Step-by-step hints for guided mode; `target` = data-assist key. */
  guide?: Array<{ target: string; message: string }>;
}

export interface FormFillResult {
  filled: string[];
  /** Keys the page could not apply (unknown value, no match…) with a reason. */
  rejected: Array<{ key: string; reason: string }>;
  /** Required keys still empty after the fill. */
  missing: string[];
  /** Page-side remark for the model, e.g. a fuzzy match it should confirm. */
  note?: string;
}

export interface FormBinding {
  def: FormDef;
  /** Apply values; return which were applied / rejected. May be async (entity lookups). */
  set: (
    values: Record<string, unknown>,
  ) => Promise<Partial<FormFillResult>> | Partial<FormFillResult>;
  /** Current values, used to compute `missing`. */
  get: () => Record<string, unknown>;
}

export const fillToolName = (formId: string) => `fill_${formId}`;

export function fieldsSchema(def: FormDef): JsonSchema {
  const properties: Record<string, unknown> = {};
  for (const f of def.fields) {
    const p: Record<string, unknown> = {
      type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string',
      description: [
        f.label,
        f.description,
        f.entity ? `(${f.entity})` : '',
        f.type === 'date' ? 'YYYY-MM-DD' : '',
      ]
        .filter(Boolean)
        .join(' — '),
    };
    if (f.options) p.enum = f.options.map((o) => o.value);
    properties[f.key] = p;
  }
  return {
    type: 'object',
    properties,
    required: def.fields.filter((f) => f.required).map((f) => f.key),
  };
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Register a mounted form. Returns the disposer (call on unmount). */
export function registerForm(binding: FormBinding): () => void {
  const { def } = binding;
  const ac = new AbortController();
  registerTool(
    {
      name: fillToolName(def.id),
      description: `Fill the "${def.title}" form on screen (${def.description}). Only fills — the user reviews and submits. Pass only the fields you know; omit unknown ones.`,
      inputSchema: fieldsSchema(def),
      execute: async (input) => {
        const r = await binding.set(input);
        const current = binding.get();
        const missing = def.fields
          .filter((f) => f.required && isEmpty(current[f.key]))
          .map((f) => f.key);
        const rejected = r.rejected ?? [];
        const bad = new Set(rejected.map((x) => x.key));
        const result: FormFillResult = {
          filled: (r.filled ?? Object.keys(input)).filter((k) => !bad.has(k)),
          rejected,
          missing,
        };
        if (r.note) result.note = r.note;
        return result;
      },
    },
    { signal: ac.signal },
  );
  return () => ac.abort();
}

/** Catalog entry for the model: where the form is and what it takes. */
export function describeForm(def: FormDef): string {
  const open = def.open ? `?${new URLSearchParams(def.open).toString()}` : '';
  const fields = def.fields
    .map(
      (f) =>
        `${f.key}${f.required ? '*' : ''}:${f.type}${f.options ? `[${f.options.map((o) => o.value).join('|')}]` : ''}`,
    )
    .join(', ');
  return `${def.id} — ${def.title} at ${def.route}${open} (${def.description}). Fields: ${fields}`;
}
