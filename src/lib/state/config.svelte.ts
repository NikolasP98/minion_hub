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

// ─── Actions ────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<void> {
  configState.loading = true;
  configState.loadError = null;

  try {
    const [snapshot, schemaRes] = await Promise.all([
      sendRequest('config.get', {}) as Promise<ConfigFileSnapshot>,
      sendRequest('config.schema', {}) as Promise<ConfigSchemaResponse>,
    ]);

    configState.schema = schemaRes.schema;
    configState.uiHints = schemaRes.uiHints ?? {};
    configState.version = schemaRes.version;

    configState.original = (snapshot.config ?? {}) as Record<string, unknown>;
    configState.current = structuredClone(configState.original);
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

    // Reload to get fresh hash + canonical state
    await loadConfig();
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? 'Save failed';
    configState.saveError = msg;
    return false;
  } finally {
    configState.saving = false;
  }
}

export function discard(): void {
  configState.current = structuredClone(configState.original);
  configState.saveError = null;
}
