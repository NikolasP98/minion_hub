/** Admission limits bound chart work. Exceeding them is a failed read, never a truncated total. */
export const MAX_AGGREGATE_ROWS = 20_000;

export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid reliability response');
  return raw as Record<string, unknown>;
}

export function number(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)
    throw new Error('Invalid reliability number');
  return raw;
}

export function finite(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw))
    throw new Error('Invalid reliability number');
  return raw;
}

export function integer(raw: unknown): number {
  const value = number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid reliability integer');
  return value;
}

export function boolean(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new Error('Invalid reliability boolean');
  return raw;
}

export function nullableNumber(raw: unknown): number | null {
  return raw === null ? null : number(raw);
}

export function optionalString(raw: unknown, max = 512): string | undefined {
  return raw === undefined ? undefined : string(raw, max);
}

export function string(raw: unknown, max = 512): string {
  if (typeof raw !== 'string' || raw.length > max) throw new Error('Invalid reliability string');
  return raw;
}

export function rows<T>(raw: unknown, decode: (row: unknown) => T, max = MAX_AGGREGATE_ROWS): T[] {
  if (!Array.isArray(raw) || raw.length > max) throw new Error('Invalid reliability rows');
  return raw.map(decode);
}

export function numbers<K extends string>(raw: unknown, keys: readonly K[]): Record<K, number> {
  const value = record(raw);
  return Object.fromEntries(keys.map((key) => [key, number(value[key])])) as Record<K, number>;
}

export function countMap(raw: unknown): Record<string, number> {
  const entries = Object.entries(record(raw));
  if (entries.length > 256) throw new Error('Invalid reliability dimensions');
  return Object.fromEntries(entries.map(([key, value]) => [string(key), integer(value)]));
}

/** Metadata stays extensible, but cannot allocate an unbounded recursive details view. */
export function metadata(raw: unknown): Record<string, unknown> {
  let remaining = 4096;
  function visit(value: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 8) throw new Error('Invalid reliability metadata');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid reliability metadata number');
      return value;
    }
    if (typeof value === 'string') return string(value, 16_384);
    if (Array.isArray(value)) return rows(value, (item) => visit(item, depth + 1), 256);
    const entries = Object.entries(record(value));
    if (entries.length > 256) throw new Error('Invalid reliability metadata fields');
    return Object.fromEntries(entries.map(([key, item]) => [string(key), visit(item, depth + 1)]));
  }
  return record(visit(record(raw), 0));
}
