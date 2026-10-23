/** Private live checks for effects that can resume after suspended clocks or awaits.
 * This is a restriction, never an invocation/publication capability. Manual callers
 * without an accepted lease keep their ordinary signal-based behavior.
 */
export interface EffectLease {
  readonly signal: AbortSignal;
}
const checks = new WeakMap<object, () => boolean>();
export function bindEffectLease<T extends EffectLease>(context: T, current: () => boolean): T {
  Object.freeze(context);
  checks.set(context, current);
  return context;
}
export function isEffectCurrent(context?: { readonly signal?: AbortSignal }): boolean {
  return !context?.signal?.aborted && (!context || (checks.get(context)?.() ?? true));
}
