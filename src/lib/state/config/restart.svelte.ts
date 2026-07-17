/**
 * Gateway restart state machine (reactive shell around ./config-restart).
 *
 * Lives OUTSIDE config.svelte.ts on purpose: the gateway service needs
 * restartState synchronously in its reconnect paths, and importing the config
 * editor module from there dragged config-schema + the full paraglide messages
 * chunk (~495KB) into the eager shell bundle. This module keeps messages lazy.
 */
import { toaster, toastError, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
import { updateState } from '$lib/state/gateway/update-state.svelte';
import {
  type RestartStateData,
  createRestartState,
  applyBeginRestart,
  applyReconnected,
  applyReset,
  RESTART_TIMEOUT_MS,
} from './config-restart';

const msgs = () => import('$lib/paraglide/messages');

export const restartState = $state<RestartStateData>(createRestartState());

// Dirty-check seam: config.svelte.ts registers its computed isDirty here so
// this module never has to import the config editor (and its messages chain).
// Until the config module loads there are no edits, so `false` is correct.
let dirtyCheck: () => boolean = () => false;
export function registerRestartDirtyCheck(fn: () => boolean): void {
  dirtyCheck = fn;
}

let _restartTimeoutId: ReturnType<typeof setTimeout> | null = null;
let _dismissTimeoutId: ReturnType<typeof setTimeout> | null = null;
let _restartToastId: string | null = null;

export function beginRestart() {
  _clearRestartTimers();
  Object.assign(restartState, applyBeginRestart(restartState, Date.now()));
  if (_restartToastId) {
    toaster.dismiss(_restartToastId);
    _restartToastId = null;
  }
  // During an update install the Updates card's progress bar + the calm
  // connection banner already narrate the restart — skip the duplicate toast.
  if (!updateState.installing) {
    // Lazy messages: guard on phase so a reconnect that lands before the
    // chunk resolves doesn't leave an orphaned loading toast.
    void msgs().then((m) => {
      if (restartState.phase !== 'restarting' || updateState.installing) return;
      _restartToastId = toaster.create({
        title: m.config_gatewayRestarting(),
        type: 'loading',
        duration: Infinity,
      });
    });
  }
  _restartTimeoutId = setTimeout(() => {
    if (restartState.phase === 'restarting') {
      restartState.phase = 'failed';
      if (_restartToastId) {
        toaster.dismiss(_restartToastId);
        _restartToastId = null;
      }
      if (updateState.installing) {
        // An update install (npm install + restart + boot) routinely exceeds
        // this 30s window — that's expected, not a failure. Unstick the
        // Updates card button and say what's actually happening instead of
        // showing the generic reconnect-failed error.
        updateState.installing = false;
        void msgs().then((m) => toastWarning(m.gateway_update_restarting()));
      } else {
        void msgs().then((m) => toastError(m.config_reconnectFailed(), m.config_reconnectManually()));
      }
    }
  }, RESTART_TIMEOUT_MS);
}

export function onRestartReconnected(opts?: { silent?: boolean }) {
  _clearRestartTimers();
  if (_restartToastId) {
    toaster.dismiss(_restartToastId);
    _restartToastId = null;
  }
  const dirty = dirtyCheck();
  Object.assign(restartState, applyReconnected(restartState, dirty));
  // silent: the caller already showed a more specific toast for this
  // reconnect (e.g. the update success/mismatch toast) — one toast per event.
  if (opts?.silent) {
    // no generic toast
  } else if (dirty) {
    void msgs().then((m) => toastWarning(m.config_gatewayReconnected(), m.config_unsavedPreserved()));
  } else {
    void msgs().then((m) => toastSuccess(m.config_gatewayReconnected(), m.config_changesApplied()));
  }
  _dismissTimeoutId = setTimeout(() => {
    if (restartState.phase === 'reconnected') {
      resetRestartState();
    }
  }, 0);
}

export function resetRestartState() {
  _clearRestartTimers();
  Object.assign(restartState, applyReset(restartState));
}

function _clearRestartTimers() {
  if (_restartTimeoutId) {
    clearTimeout(_restartTimeoutId);
    _restartTimeoutId = null;
  }
  if (_dismissTimeoutId) {
    clearTimeout(_dismissTimeoutId);
    _dismissTimeoutId = null;
  }
}
