import { getContext, setContext } from 'svelte';

/** What anything outside `ShiftDialogs` may do: ask for a shift dialog. */
export interface ShiftDialogsApi {
  startOpen(): void;
  startClose(): void;
}

interface ShiftDialogsController extends ShiftDialogsApi {
  /** `ShiftDialogs` plugs its real handlers in once mounted. */
  register(impl: ShiftDialogsApi): void;
}

const KEY = Symbol('pos-shift-dialogs');

// Per-layout instance (never module state: SSR shares modules across requests).
export function setShiftDialogs(): ShiftDialogsController {
  let impl: ShiftDialogsApi | undefined;
  return setContext<ShiftDialogsController>(KEY, {
    startOpen: () => impl?.startOpen(),
    startClose: () => impl?.startClose(),
    register: (next) => {
      impl = next;
    },
  });
}

/** Undefined outside the POS layout tree (stories, tests). */
export function getShiftDialogs(): ShiftDialogsApi | undefined {
  return getContext<ShiftDialogsController | undefined>(KEY);
}

/** For `ShiftDialogs` only. */
export function getShiftDialogsController(): ShiftDialogsController | undefined {
  return getContext<ShiftDialogsController | undefined>(KEY);
}
