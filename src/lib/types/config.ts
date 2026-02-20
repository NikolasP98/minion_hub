/** Types for the config settings page — mirrors gateway's config WS protocol */

// ─── UI Hints (from gateway's schema.hints.ts) ─────────────────────────────

export type ConfigUiHint = {
  label?: string;
  help?: string;
  group?: string;
  order?: number;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  itemTemplate?: unknown;
};

export type ConfigUiHints = Record<string, ConfigUiHint>;

// ─── JSON Schema types (Draft-07 subset we actually use) ────────────────────

export type JsonSchemaNode = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  required?: string[];
  items?: JsonSchemaNode | JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  /** Zod-sourced sensitive marker */
  sensitive?: boolean;
  /** $ref pointer (pre-resolved by gateway, but may appear) */
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
};

// ─── WS response shapes ────────────────────────────────────────────────────

export type ConfigFileSnapshot = {
  path: string;
  exists: boolean;
  raw: string | null;
  parsed: unknown;
  resolved: Record<string, unknown>;
  valid: boolean;
  config: Record<string, unknown>;
  hash?: string;
  issues: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
  legacyIssues: LegacyConfigIssue[];
};

export type ConfigValidationIssue = {
  path: string;
  message: string;
};

export type LegacyConfigIssue = {
  path: string;
  message: string;
  migration?: string;
};

export type ConfigSchemaResponse = {
  schema: JsonSchemaNode;
  uiHints: ConfigUiHints;
  version: string;
  generatedAt: string;
};

export type ConfigPatchResult = {
  ok: boolean;
  path: string;
  config: Record<string, unknown>;
  restart?: { delayMs: number; reason: string };
  sentinel?: { path: string | null; payload: unknown };
};

// ─── UI-side types ─────────────────────────────────────────────────────────

export type ConfigGroup = {
  id: string;
  label: string;
  order: number;
  fields: ConfigGroupField[];
};

export type ConfigGroupField = {
  key: string;
  path: string;
  schema: JsonSchemaNode;
  hint: ConfigUiHint;
};

/** What kind of widget to render */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'multi-enum'
  | 'select' // anyOf/oneOf with literals
  | 'sensitive'
  | 'object'
  | 'record' // object with additionalProperties
  | 'array-string'
  | 'array-object'
  | 'array-enum'
  | 'json'; // fallback

export const REDACTED_SENTINEL = '__OPENCLAW_REDACTED__';
