export const BASELINE_PATH: string;
export const PREFIX_MODULES: Record<string, string>;
export function moduleForLoadPath(file: string): string;
export function collect(): Record<string, number>;
export function readBaseline(): Record<string, number>;
export function violations(
  counts: Record<string, number>,
  baseline: Record<string, number>,
  enforced: readonly string[],
): { rule: 'enforced' | 'raised' | 'unknown' | 'stale'; msg: string }[];
export function readApiBaseline(): Record<string, number>;
export function collectApiGets(): Record<string, number>;
export function apiViolations(
  current: Record<string, number>,
  baseline: Record<string, number>,
): { rule: 'api-new' | 'api-stale'; msg: string }[];
