import * as toast from '@zag-js/toast';
import { announce } from '$lib/a11y/announce';

export const toaster = toast.createStore({
  placement: 'top-end',
  overlap: true,
  max: 6,
  gap: 12,
  offsets: { top: '64px', right: '12px', left: 'auto', bottom: 'auto' },
});

// Every toast is SPOKEN through the shared announcer, not by the toast region: the
// announcer exists before the (deferred) Toaster mounts, so an early toast is not lost, and
// an error can interrupt while the rest waits its turn. Patched on the store so the helpers
// below and the few direct `toaster.create` callers share it.
function say(options: Partial<toast.Options>) {
  const text = [options.title, options.description]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('. ');
  if (text) announce(text, options.type === 'error' ? 'assertive' : 'polite');
}
const createToast = toaster.create.bind(toaster);
toaster.create = (options) => {
  say(options);
  return createToast(options);
};
const updateToast = toaster.update.bind(toaster);
toaster.update = (id, options) => {
  say(options);
  return updateToast(id, options);
};

type ToastOverrides = Partial<toast.Options>;

interface ToastOutcome {
  type: 'success' | 'error' | 'warning' | 'info' | 'loading';
  title: string;
  description?: string;
}

/**
 * Wrap an async operation in a loading → result toast lifecycle.
 * The same toast updates in place from loading → final type.
 *
 * Usage:
 *   await toastAsync(
 *     sendRequest(...),
 *     {
 *       loading: 'Probing secret…',
 *       getOutcome: (res) =>
 *         res.status === 'ok'
 *           ? { type: 'success', title: 'Probe OK' }
 *           : { type: 'error', title: 'Probe failed', description: res.message },
 *     }
 *   );
 */
export async function toastAsync<T>(
  operation: Promise<T> | (() => Promise<T>),
  messages: {
    loading: string;
    description?: string;
    getOutcome: (value: T) => ToastOutcome;
    onError?: (err: unknown) => { title: string; description?: string };
  },
): Promise<T> {
  const id = toaster.create({
    title: messages.loading,
    description: messages.description,
    type: 'loading',
    duration: Infinity,
    removeDelay: 200,
  });

  try {
    const promise = operation instanceof Promise ? operation : operation();
    const value = await promise;
    const outcome = messages.getOutcome(value);

    const duration = outcome.type === 'error' ? 8000 : outcome.type === 'warning' ? 6000 : 4000;

    toaster.update(id, {
      type: outcome.type,
      title: outcome.title,
      description: outcome.description,
      duration,
    });

    return value;
  } catch (err) {
    const outcome = messages.onError?.(err) ?? {
      title: messages.loading.replace(/[…\.]+$/, ' failed'),
      description: err instanceof Error ? err.message : String(err),
    };

    toaster.update(id, {
      type: 'error',
      title: outcome.title,
      description: outcome.description,
      duration: 8000,
    });

    throw err;
  }
}

/**
 * Simple convenience for cases where promise resolve = success, reject = error.
 * Implemented on top of toastAsync for full type control.
 */
export function toastPromise<T>(
  promise: Promise<T> | (() => Promise<T>),
  messages: {
    loading: string;
    success: string | ((value: T) => string);
    error?: string | ((err: unknown) => string);
    description?: string;
  },
  _overrides?: ToastOverrides,
): Promise<T> {
  return toastAsync(promise, {
    loading: messages.loading,
    description: messages.description,
    getOutcome: (value) => ({
      type: 'success',
      title: typeof messages.success === 'function' ? messages.success(value) : messages.success,
    }),
    onError: (err) => ({
      title:
        typeof messages.error === 'function'
          ? messages.error(err)
          : (messages.error ?? 'Something went wrong'),
      description: err instanceof Error ? err.message : String(err),
    }),
  });
}

export function toastInfo(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'info', ...overrides });
}

export function toastSuccess(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'success', duration: 4000, ...overrides });
}

export function toastError(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'error', duration: 8000, ...overrides });
}

export function toastWarning(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'warning', duration: 6000, ...overrides });
}

export function toastLoading(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'loading', duration: Infinity, ...overrides });
}
