/**
 * Pure utility functions for config schema interpretation, dirty tracking, and patching.
 */
import type {
  JsonSchemaNode,
  ConfigUiHints,
  ConfigUiHint,
  ConfigGroup,
  ConfigGroupField,
  FieldType,
} from '$lib/types/config';
import { REDACTED_SENTINEL } from '$lib/types/config';

// ─── Meta-groups (logical groupings for the UI sidebar) ─────────────────────
//
// Groups are assigned to meta-groups by their ORDER value (from GROUP_ORDER),
// not by ID string matching. This is resilient to gateways that use different
// config key names. Order ranges are non-overlapping and cover all values.
//
//   Setup        < 40   wizard, update, diagnostics, gateway, nodeHost
//   AI          40-79   agents, tools, bindings, audio, models
//   Automation  80-129  messages, commands, session, cron, hooks, ui
//   Comms      130-199  browser, talk, channels
//   Extensions 200-499  skills, plugins, discovery, presence, voicewake
//   System      500+    logging (and any unknown high-order groups)

export const META_GROUPS: { id: string; label: string; minOrder: number; maxOrder: number }[] = [
  { id: 'setup',      label: 'Setup',         minOrder: 0,   maxOrder: 39  },
  { id: 'ai',         label: 'AI',            minOrder: 40,  maxOrder: 79  },
  { id: 'automation', label: 'Automation',    minOrder: 80,  maxOrder: 129 },
  { id: 'comms',      label: 'Communication', minOrder: 130, maxOrder: 199 },
  { id: 'extensions', label: 'Extensions',    minOrder: 200, maxOrder: 499 },
  { id: 'system',     label: 'System',        minOrder: 500, maxOrder: Infinity },
];

/** Returns the meta-group ID for a given group order value. */
export function getMetaGroupId(order: number): string {
  for (const m of META_GROUPS) {
    if (order >= m.minOrder && order <= m.maxOrder) return m.id;
  }
  return 'system'; // fallback
}

// ─── Group order (mirrors gateway's GROUP_ORDER) ────────────────────────────

const GROUP_ORDER: Record<string, number> = {
  wizard: 20, update: 25, diagnostics: 27, gateway: 30, nodeHost: 35,
  agents: 40, tools: 50, bindings: 55, audio: 60, models: 70,
  messages: 80, commands: 85, session: 90, cron: 100, hooks: 110,
  ui: 120, browser: 130, talk: 140, channels: 150, skills: 200,
  plugins: 205, discovery: 210, presence: 220, voicewake: 230, logging: 900,
};

const GROUP_LABELS: Record<string, string> = {
  wizard: 'Wizard', update: 'Update', diagnostics: 'Diagnostics',
  logging: 'Logging', gateway: 'Gateway', nodeHost: 'Node Host',
  agents: 'Agents', tools: 'Tools', bindings: 'Bindings',
  audio: 'Audio', models: 'Models', messages: 'Messages',
  commands: 'Commands', session: 'Session', cron: 'Cron',
  hooks: 'Hooks', ui: 'UI', browser: 'Browser', talk: 'Talk',
  channels: 'Messaging Channels', skills: 'Skills', plugins: 'Plugins',
  discovery: 'Discovery', presence: 'Presence', voicewake: 'Voice Wake',
};

// ─── Field type resolution ──────────────────────────────────────────────────

export function resolveFieldType(schema: JsonSchemaNode, hint?: ConfigUiHint): FieldType {
  if (hint?.sensitive) return 'sensitive';

  // anyOf/oneOf with all-const → select dropdown
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants && variants.every((v) => v.const !== undefined || v.enum)) {
    return 'select';
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === 'boolean') return 'boolean';

  if (type === 'string') {
    if (schema.enum && schema.enum.length > 0) return 'enum';
    return 'string';
  }

  if (type === 'number' || type === 'integer') return 'number';

  if (type === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (!items) return 'array-string';
    const itemType = Array.isArray(items.type) ? items.type[0] : items.type;
    if (items.enum) return 'array-enum';
    if (itemType === 'string') return 'array-string';
    if (itemType === 'object') return 'array-object';
    return 'json';
  }

  if (type === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) return 'object';
    if (schema.additionalProperties) return 'record';
    return 'json';
  }

  return 'json';
}

// ─── Group extraction ───────────────────────────────────────────────────────

/**
 * Builds sorted groups from schema top-level keys + ui hints.
 * Each top-level key becomes a field in the group determined by its hint.
 */
export function extractGroups(
  schema: JsonSchemaNode | null,
  uiHints: ConfigUiHints,
): ConfigGroup[] {
  if (!schema?.properties) return [];

  const groupMap = new Map<string, ConfigGroup>();

  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const hint = uiHints[key] ?? {};
    // Determine group: explicit hint.group, or infer from key
    const groupId = hint.group ?? key;
    const groupLabel = GROUP_LABELS[groupId] ?? capitalize(groupId);
    const groupOrder = GROUP_ORDER[groupId] ?? 500;

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, { id: groupId, label: groupLabel, order: groupOrder, fields: [] });
    }

    groupMap.get(groupId)!.fields.push({
      key,
      path: key,
      schema: fieldSchema,
      hint,
    });
  }

  // Sort groups by order, then fields within each group by hint.order
  const groups = [...groupMap.values()].sort((a, b) => a.order - b.order);
  for (const g of groups) {
    g.fields.sort((a, b) => (a.hint.order ?? 999) - (b.hint.order ?? 999));
  }
  return groups;
}

// ─── Deep get/set ───────────────────────────────────────────────────────────

export function deepGet(obj: unknown, path: string): unknown {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== 'object') {
      // Peek ahead: if next part is a digit, create an array
      cur[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (value === undefined) {
    delete cur[lastPart];
  } else {
    cur[lastPart] = value;
  }
}

export function deepDelete(obj: Record<string, unknown>, path: string): void {
  deepSet(obj, path, undefined);
}

function parsePath(path: string): string[] {
  // Split on '.' but not inside brackets; also handle 'foo[0].bar'
  return path.replace(/\[(\d+)]/g, '.$1').split('.').filter(Boolean);
}

// ─── Dirty tracking ─────────────────────────────────────────────────────────

/**
 * Returns set of dot-paths that differ between original and current.
 * Only compares leaf values. Operates on the top-level config keys.
 */
export function computeDirtyPaths(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
): Set<string> {
  const dirty = new Set<string>();
  const allKeys = new Set([...Object.keys(original), ...Object.keys(current)]);
  for (const key of allKeys) {
    if (!deepEqual(original[key], current[key])) {
      dirty.add(key);
    }
  }
  return dirty;
}

/**
 * Returns set of dot-paths (at any depth) that differ between original and current.
 * Used for per-field dirty indicators.
 */
export function computeDeepDirtyPaths(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
  prefix = '',
): Set<string> {
  const dirty = new Set<string>();
  const allKeys = new Set([...Object.keys(original ?? {}), ...Object.keys(current ?? {})]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const origVal = (original ?? {} as Record<string, unknown>)[key];
    const curVal = (current ?? {} as Record<string, unknown>)[key];
    if (!deepEqual(origVal, curVal)) {
      dirty.add(path);
      // Also recurse into objects for finer granularity
      if (isPlainObject(origVal) && isPlainObject(curVal)) {
        for (const sub of computeDeepDirtyPaths(
          origVal as Record<string, unknown>,
          curVal as Record<string, unknown>,
          path,
        )) {
          dirty.add(sub);
        }
      }
    }
  }
  return dirty;
}

// ─── Patch computation ──────────────────────────────────────────────────────

/**
 * Computes a JSON merge-patch from original → current.
 * Strips redacted sentinels (omitted = unchanged in merge-patch semantics).
 * Deleted keys become `null` (merge-patch convention).
 */
export function computePatch(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch = diffObjects(original, current);
  if (patch === null || Object.keys(patch).length === 0) return null;
  stripRedactedSentinels(patch);
  if (Object.keys(patch).length === 0) return null;
  return patch;
}

function diffObjects(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(original), ...Object.keys(current)]);

  for (const key of allKeys) {
    const origVal = original[key];
    const curVal = current[key];

    // Key deleted in current
    if (curVal === undefined && origVal !== undefined) {
      patch[key] = null; // merge-patch: null = delete
      continue;
    }

    // Key added in current
    if (origVal === undefined && curVal !== undefined) {
      patch[key] = curVal;
      continue;
    }

    // Both objects → recurse
    if (isPlainObject(origVal) && isPlainObject(curVal)) {
      const sub = diffObjects(
        origVal as Record<string, unknown>,
        curVal as Record<string, unknown>,
      );
      if (sub !== null && Object.keys(sub).length > 0) {
        patch[key] = sub;
      }
      continue;
    }

    // Leaf comparison
    if (!deepEqual(origVal, curVal)) {
      patch[key] = curVal;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function stripRedactedSentinels(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === REDACTED_SENTINEL) {
      delete obj[key]; // omit = unchanged in merge-patch
    } else if (isPlainObject(val)) {
      stripRedactedSentinels(val as Record<string, unknown>);
      if (Object.keys(val as Record<string, unknown>).length === 0) {
        delete obj[key];
      }
    }
  }
}

// ─── Value inspection ───────────────────────────────────────────────────────

/** Returns true if value has meaningful content (non-null, non-empty object/array) */
export function hasConfiguredValues(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => hasConfiguredValues(v));
  }
  return false;
}

/** Count how many top-level properties in an object have configured values */
export function countConfiguredKeys(value: unknown): number {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).filter((v) => hasConfiguredValues(v)).length;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      if (!deepEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
