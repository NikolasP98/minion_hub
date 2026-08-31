/**
 * PostgreSQL error introspection, shared by every service that turns a
 * constraint violation into a domain outcome.
 *
 * Lives here rather than in one service because the wrapping it works around
 * is a property of the DRIVER, not of any module: drizzle wraps driver errors
 * in `DrizzleQueryError`, so the SQLSTATE lives on `e.cause`, not on `e`. A
 * bare `e.code === '23505'` check therefore never matches, and the caller's
 * intended branch (idempotent enqueue, `code_taken`, `item_taken`) is silently
 * dead while the raw error escapes as a 500.
 *
 * Live-verified twice: once by a duplicate-active-job insert that 500'd the
 * meta run route, and once by `pos.sellables.concurrent.integration.test.ts`,
 * where a genuinely concurrent `updateSellable` surfaced the raw
 * `DrizzleQueryError` instead of the typed `item_taken` the unit tests
 * (which inject a bare `{code: '23505'}`) reported as working.
 */
export function pgErrorCode(e: unknown): string | undefined {
  for (let cur = e; cur && typeof cur === 'object'; cur = (cur as { cause?: unknown }).cause) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}
