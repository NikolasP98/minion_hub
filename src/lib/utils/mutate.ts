import { toaster, toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

export interface MutateOptions<T> {
  /** Optional loading toast shown immediately; auto-dismissed on resolve/reject. */
  loadingToast?: string;
  /** Success toast title, or a function deriving it from the result. */
  successToast?: string | ((result: T) => string);
  /** Optional success description (only used when successToast is a string). */
  successDescription?: string;
  /** Error toast title, or a function deriving it from the thrown error. */
  errorToast?: string | ((err: unknown) => string);
  /** Throw on error instead of swallowing. Default `false` (returns `undefined`). */
  rethrow?: boolean;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

/**
 * Wraps an async mutation with toast feedback. Makes acked feedback the default
 * path so silent success/failure becomes the exception, not the rule.
 *
 * Returns the resolved value, or `undefined` on error (unless `rethrow: true`).
 */
export async function mutate<T>(
  fn: () => Promise<T>,
  opts: MutateOptions<T> = {}
): Promise<T | undefined> {
  let loadingId: string | undefined;

  if (opts.loadingToast) {
    loadingId = toaster.create({
      title: opts.loadingToast,
      type: 'loading',
      duration: Infinity,
    });
  }

  try {
    const result = await fn();
    if (loadingId) toaster.remove(loadingId);

    if (opts.successToast) {
      const title =
        typeof opts.successToast === 'function' ? opts.successToast(result) : opts.successToast;
      toastSuccess(title, opts.successDescription);
    }
    return result;
  } catch (err) {
    if (loadingId) toaster.remove(loadingId);

    const title =
      typeof opts.errorToast === 'function'
        ? opts.errorToast(err)
        : (opts.errorToast ?? errMessage(err));
    toastError(title);

    if (opts.rethrow) throw err;
    return undefined;
  }
}
