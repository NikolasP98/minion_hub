import { NotificationInputError, type CanonicalValue } from './canonical';

export type ScalarRule = 'uuid' | 'revision' | 'instant' | 'date' | 'currency' | 'digest' | 'role';
export type FieldRule =
  | ScalarRule
  | { readonly values: readonly string[] }
  | { readonly items: 'uuid' | 'role'; readonly maximum: number };
export type ValueFor<R extends FieldRule> = R extends { readonly items: ScalarRule }
  ? readonly string[]
  : R extends { readonly values: readonly (infer V)[] }
    ? V
    : string;
export type PayloadForFields<F extends Readonly<Record<string, FieldRule>>> = {
  readonly [K in keyof F]: ValueFor<F[K]>;
};

export const BOOKING_STATUS_VALUES = [
  'pending',
  'accepted',
  'completed',
  'no_show',
  'cancelled',
  'rejected',
] as const;
export const FAILURE_CLASSES = [
  'dependency_unavailable',
  'deadline_exceeded',
  'input_invalid',
  'permission_revoked',
  'capacity_exceeded',
  'internal_failure',
] as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validScalar(rule: ScalarRule, value: string): boolean {
  switch (rule) {
    case 'uuid':
      return UUID_PATTERN.test(value);
    case 'revision':
      return /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
    case 'role':
      return /^[a-z][a-z0-9_-]{0,99}$/.test(value);
    case 'currency':
      return /^[A-Z]{3}$/.test(value);
    case 'digest':
      return /^[a-f0-9]{64}$/.test(value);
    case 'instant':
      return (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
      );
    case 'date':
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) &&
        new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value
      );
  }
}

export function admitFields(
  fields: Readonly<Record<string, FieldRule>>,
  input: CanonicalValue,
): void {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new NotificationInputError('invalid_object');
  const keys = Object.keys(input);
  // Error paths come from the registry, never arbitrary attacker-controlled field names.
  if (
    keys.length !== Object.keys(fields).length ||
    keys.some((key) => !Object.hasOwn(fields, key))
  ) {
    throw new NotificationInputError('invalid_field');
  }
  for (const [name, rule] of Object.entries(fields)) {
    const value = input[name];
    let valid: boolean;
    if (typeof rule === 'string') valid = typeof value === 'string' && validScalar(rule, value);
    else if ('values' in rule) valid = typeof value === 'string' && rule.values.includes(value);
    else
      valid =
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= rule.maximum &&
        new Set(value).size === value.length &&
        value.every((entry) => typeof entry === 'string' && validScalar(rule.items, entry));
    if (!valid) throw new NotificationInputError('invalid_field', `$.${name}`);
  }
}
