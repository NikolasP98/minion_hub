/**
 * Reactive config state — loads remote config + schema via WS,
 * tracks edits, computes patches, and saves.
 */
import { sendRequest } from '$lib/services/gateway.svelte';
import { extractGroups, computeDirtyPaths, computePatch, deepGet, deepSet } from '$lib/utils/config-schema';
import type {
  ConfigFileSnapshot,
  ConfigSchemaResponse,
  ConfigUiHints,
  ConfigGroup,
  JsonSchemaNode,
} from '$lib/types/config';

// ─── State ──────────────────────────────────────────────────────────────────

export const configState = $state({
  loading: false,
  loaded: false,
  loadError: null as string | null,

  schema: null as JsonSchemaNode | null,
  uiHints: {} as ConfigUiHints,

  original: {} as Record<string, unknown>,
  current: {} as Record<string, unknown>,
  baseHash: null as string | null,

  saving: false,
  saveError: null as string | null,
  lastSavedAt: null as number | null,

  /** Version string from config.schema */
  version: null as string | null,
  /** Config file path on the remote */
  configPath: null as string | null,
  /** Validation issues from last load */
  issues: [] as { path: string; message: string }[],
  warnings: [] as { path: string; message: string }[],
});

// ─── Derived (exported as getters — Svelte modules can't export $derived) ──

const _dirtyPaths = $derived(computeDirtyPaths(configState.original, configState.current));
const _isDirty = $derived(_dirtyPaths.size > 0);
const _groups: ConfigGroup[] = $derived(extractGroups(configState.schema, configState.uiHints));

export const dirtyPaths = { get value() { return _dirtyPaths; } };
export const isDirty = { get value() { return _isDirty; } };
export const groups = { get value() { return _groups; } };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** JSON round-trip clone — avoids structuredClone failure on Svelte $state Proxies */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Build a minimal schema from the config object keys so we can still render fields */
function inferSchemaFromConfig(config: Record<string, unknown>): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {};
  for (const [key, val] of Object.entries(config)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      properties[key] = { type: 'object', title: key, properties: inferProperties(val as Record<string, unknown>) };
    } else if (Array.isArray(val)) {
      properties[key] = { type: 'array', title: key };
    } else if (typeof val === 'boolean') {
      properties[key] = { type: 'boolean', title: key };
    } else if (typeof val === 'number') {
      properties[key] = { type: 'number', title: key };
    } else {
      properties[key] = { type: 'string', title: key };
    }
  }
  return { type: 'object', properties };
}

function inferProperties(obj: Record<string, unknown>): Record<string, JsonSchemaNode> {
  const props: Record<string, JsonSchemaNode> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      props[key] = { type: 'object', title: key, properties: inferProperties(val as Record<string, unknown>) };
    } else if (Array.isArray(val)) {
      props[key] = { type: 'array', title: key };
    } else if (typeof val === 'boolean') {
      props[key] = { type: 'boolean', title: key };
    } else if (typeof val === 'number') {
      props[key] = { type: 'number', title: key };
    } else {
      props[key] = { type: 'string', title: key };
    }
  }
  return props;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<void> {
  configState.loading = true;
  configState.loadError = null;

  try {
    // config.get is required; config.schema is optional (older gateways may not support it)
    const snapshotP = withTimeout(
      sendRequest('config.get', {}) as Promise<ConfigFileSnapshot>,
      10000,
    );
    const schemaP = withTimeout(
      sendRequest('config.schema', {}) as Promise<ConfigSchemaResponse>,
      8000,
    ).catch(() => null); // gracefully degrade if unavailable

    const [snapshot, schemaRes] = await Promise.all([snapshotP, schemaP]);

    if (schemaRes) {
      configState.schema = schemaRes.schema;
      configState.uiHints = schemaRes.uiHints ?? {};
      configState.version = schemaRes.version;
    } else {
      // Fallback: infer a minimal schema from the config object
      const config = (snapshot.config ?? {}) as Record<string, unknown>;
      configState.schema = inferSchemaFromConfig(config);
      configState.uiHints = {};
      configState.version = null;
    }

    configState.original = (snapshot.config ?? {}) as Record<string, unknown>;
    configState.current = deepClone(configState.original);
    configState.baseHash = snapshot.hash ?? null;
    configState.configPath = snapshot.path;
    configState.issues = snapshot.issues ?? [];
    configState.warnings = snapshot.warnings ?? [];

    configState.loaded = true;
    configState.saveError = null;
  } catch (e) {
    configState.loadError = (e as Error).message ?? 'Failed to load config';
    configState.loaded = false;
  } finally {
    configState.loading = false;
  }
}

export function setField(path: string, value: unknown): void {
  deepSet(configState.current, path, value);
  // Force reactivity by reassigning. Svelte 5 deep $state tracking handles
  // most cases, but deep mutations on nested objects sometimes need a nudge.
  configState.current = { ...configState.current };
}

export function getField(path: string): unknown {
  return deepGet(configState.current, path);
}

export function getOriginalField(path: string): unknown {
  return deepGet(configState.original, path);
}

export async function save(): Promise<boolean> {
  const patch = computePatch(configState.original, configState.current);
  if (!patch) return true; // nothing to save

  configState.saving = true;
  configState.saveError = null;

  try {
    await sendRequest('config.patch', {
      raw: JSON.stringify(patch),
      baseHash: configState.baseHash ?? undefined,
      note: 'Edited via Minion Hub config page',
    });

    configState.lastSavedAt = Date.now();

    // Reload config asynchronously — don't fail the save if this fails.
    // The gateway may restart to apply agent changes; config will auto-reload
    // on reconnect via onHelloOk.
    loadConfig().catch(() => {});
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? 'Save failed';
    // WS closure = gateway restarted to apply changes; settings were saved.
    if (msg.includes('closed') || msg.includes('not connected')) {
      configState.saveError = 'Gateway restarted to apply changes. Settings will reload on reconnect.';
    } else {
      configState.saveError = msg;
    }
    return false;
  } finally {
    configState.saving = false;
  }
}

export function discard(): void {
  configState.current = deepClone(configState.original);
  configState.saveError = null;
}
