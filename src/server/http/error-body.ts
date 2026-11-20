/**
 * The one error body shape (spec 138 H6). `message` and `error` both carry the sentence so every
 * reader of either keeps finding a string; `code` is the machine-readable code. `extra` wins, so a
 * caller with a legacy contract can override a field (doors passes `{ error: code }`).
 */
export function errorBody(
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): { message: string; error: string; code: string; [key: string]: unknown } {
  return { message, error: message, code, ...extra };
}
