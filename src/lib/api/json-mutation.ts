import { fetchJson } from './fetch-json';

export interface JsonMutationOptions<T> {
  input: RequestInfo | URL;
  init: RequestInit;
  onSuccess?: (result: T) => void | Promise<void>;
}

/**
 * Run a JSON mutation and commit local UI state only after the server confirms
 * success. `fetchJson` rejects every non-2xx response, so `onSuccess` is the
 * single safe place for invalidation, navigation, or optimistic-state commits.
 */
export async function jsonMutation<T = unknown>({
  input,
  init,
  onSuccess,
}: JsonMutationOptions<T>): Promise<T> {
  const result = await fetchJson<T>(input, init);
  await onSuccess?.(result);
  return result;
}

export function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
