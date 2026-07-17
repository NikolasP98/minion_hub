/**
 * Reactive config state — loads remote config + schema via WS,
 * tracks edits, computes patches, and saves.
 */
import { sendRequest } from '$lib/services/gateway-rpc';
import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';
import { isAdmin } from '$lib/state/features/user.svelte';
import {
  restartState,
  beginRestart,
  resetRestartState,
  registerRestartDirtyCheck,
} from './restart.svelte';
import {
  extractGroups,
  computeDirtyPaths,
  computePatch,
  deepGet,
  deepSet,
} from '$lib/utils/config-schema';
import { type RestartPhase } from './config-restart';
import type {
  ConfigFileSnapshot,
  ConfigSchemaResponse,
  ConfigUiHints,
  ConfigGroup,
  JsonSchemaNode,
} from '$lib/types/config';

export type { RestartPhase };
// Restart machine moved to ./restart.svelte (see rationale there); re-exported
// for the config-page consumers that import it from this module.
export { restartState, beginRestart, resetRestartState, onRestartReconnected } from './restart.svelte';

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

export const dirtyPaths = {
  get value() {
    return _dirtyPaths;
  },
};
export const isDirty = {
  get value() {
    return _isDirty;
  },
};
export const groups = {
  get value() {
    return _groups;
  },
};

// Feed the restart module our dirty flag without it importing this module
// (which would re-create the eager messages chain it exists to break).
registerRestartDirtyCheck(() => _isDirty);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** JSON round-trip clone — avoids structuredClone failure on Svelte $state Proxies */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Build a minimal schema from the config object keys so we can still render fields */
function inferSchemaFromConfig(config: Record<string, unknown>): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {};
  for (const [key, val] of Object.entries(config)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      properties[key] = {
        type: 'object',
        title: key,
        properties: inferProperties(val as Record<string, unknown>),
      };
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
      props[key] = {
        type: 'object',
        title: key,
        properties: inferProperties(val as Record<string, unknown>),
      };
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
    ).catch((err) => {
      console.warn('[config] config.schema request failed, falling back to inferred schema:', err);
      return null;
    });

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

    // If we're in the middle of a restart and user has dirty changes, stash them
    const wasRestarting = restartState.phase === 'restarting';
    const hadDirty = wasRestarting && _isDirty;
    const stashedChanges: Record<string, unknown> = {};
    if (hadDirty) {
      for (const key of _dirtyPaths) {
        stashedChanges[key] = deepClone(configState.current[key]);
      }
    }

    configState.original = (snapshot.config ?? {}) as Record<string, unknown>;
    configState.current = deepClone(configState.original);
    configState.baseHash = snapshot.hash ?? null;
    configState.configPath = snapshot.path;
    configState.issues = snapshot.issues ?? [];
    configState.warnings = snapshot.warnings ?? [];

    // Re-apply stashed dirty values if user confirms
    if (hadDirty && Object.keys(stashedChanges).length > 0) {
      restartState.hadLocalChanges = true;
      const keepChanges =
        typeof window !== 'undefined' ? window.confirm(m.config_reloadDialog()) : false;
      if (keepChanges) {
        for (const [key, val] of Object.entries(stashedChanges)) {
          configState.current[key] = val;
        }
        configState.current = { ...configState.current };
      }
    }

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
  if (!isAdmin.value) return;
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

  let saveSucceeded = false;
  try {
    await sendRequest('config.patch', {
      raw: JSON.stringify(patch),
      baseHash: configState.baseHash ?? undefined,
      note: 'Edited via Minion Hub config page',
    });

    saveSucceeded = true;
    configState.lastSavedAt = Date.now();

    // Reload config — if the gateway restarts to apply changes, this will fail
    // with a 'closed'/'not connected' error which we handle below.
    try {
      await loadConfig();
      toastSuccess(m.config_configSaved());
    } catch (reloadErr) {
      const msg = (reloadErr as Error).message ?? '';
      if (msg.includes('closed') || msg.includes('not connected')) {
        // Gateway likely restarted to apply config changes — beginRestart() creates the toast
        beginRestart();
      }
      // Non-WS reload errors are non-fatal (config will reload on reconnect)
    }
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? 'Save failed';
    if (saveSucceeded && (msg.includes('closed') || msg.includes('not connected'))) {
      // The save itself went through but something closed after — beginRestart() creates the toast
      beginRestart();
    } else if (msg.includes('closed') || msg.includes('not connected')) {
      // sendRequest itself failed — save may not have reached gateway
      configState.saveError = m.config_connectionLost();
      toastError(m.config_saveFailed(), configState.saveError);
    } else {
      configState.saveError = msg;
      toastError(m.config_saveFailed(), msg);
    }
    return !saveSucceeded ? false : true;
  } finally {
    configState.saving = false;
  }
}

export function discard(): void {
  configState.current = deepClone(configState.original);
  configState.saveError = null;
  resetRestartState();
}
