/** Reference payloads are deliberately small; these bounds precede schema admission. */
export const NOTIFICATION_PAYLOAD_LIMIT = 32 * 1024;
export const NOTIFICATION_OBJECT_LIMITS = Object.freeze({
  depth: 6,
  nodes: 512,
  keys: 64,
  array: 128,
});

export type NotificationInputCode =
  | 'input_too_large'
  | 'invalid_json'
  | 'invalid_object'
  | 'invalid_unicode'
  | 'collection_limit'
  | 'invalid_field'
  | 'unknown_kind'
  | 'unsupported_version';

/** Fixed codes/paths only: received values must never enter logs or user-facing errors. */
export class NotificationInputError extends Error {
  constructor(
    readonly code: NotificationInputCode,
    readonly field = '$',
  ) {
    super(`Notification input rejected: ${code}`);
    this.name = 'NotificationInputError';
  }
}

export type CanonicalValue =
  null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };
const encoder = new TextEncoder();

export function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Does not call getters or toJSON. Returned bytes, rather than the mutable input, are authority. */
export function canonicalNotificationPayload(input: unknown): string {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  function append(value: string) {
    bytes += utf8Bytes(value);
    if (bytes > NOTIFICATION_PAYLOAD_LIMIT) throw new NotificationInputError('input_too_large');
    chunks.push(value);
  }
  function string(value: string) {
    if (value.length > NOTIFICATION_PAYLOAD_LIMIT)
      throw new NotificationInputError('input_too_large');
    if (!validUnicode(value)) throw new NotificationInputError('invalid_unicode');
    append(JSON.stringify(value));
  }
  function visit(value: unknown, depth: number) {
    if (++nodes > NOTIFICATION_OBJECT_LIMITS.nodes || depth > NOTIFICATION_OBJECT_LIMITS.depth) {
      throw new NotificationInputError('collection_limit');
    }
    if (value === null) {
      append('null');
      return;
    }
    if (typeof value === 'string') {
      string(value);
      return;
    }
    if (typeof value === 'boolean') {
      append(value ? 'true' : 'false');
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      append(JSON.stringify(value));
      return;
    }
    if (typeof value !== 'object') throw new NotificationInputError('invalid_object');
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      (!array && prototype !== Object.prototype && prototype !== null) ||
      (array && prototype !== Array.prototype) ||
      ancestors.has(value)
    ) {
      throw new NotificationInputError('invalid_object');
    }
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length !== 0)
      throw new NotificationInputError('invalid_object');
    if (
      names.length >
      (array ? NOTIFICATION_OBJECT_LIMITS.array + 1 : NOTIFICATION_OBJECT_LIMITS.keys)
    ) {
      throw new NotificationInputError('collection_limit');
    }
    ancestors.add(value);
    try {
      if (array) {
        if (value.length > NOTIFICATION_OBJECT_LIMITS.array || names.length !== value.length + 1) {
          throw new NotificationInputError('collection_limit');
        }
        append('[');
        for (let i = 0; i < value.length; i++) {
          if (i) append(',');
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
            throw new NotificationInputError('invalid_object');
          }
          visit(descriptor.value, depth + 1);
        }
        append(']');
      } else {
        append('{');
        for (const [i, name] of names.sort().entries()) {
          if (
            name.length > 96 ||
            name === '__proto__' ||
            name === 'constructor' ||
            name === 'prototype'
          ) {
            throw new NotificationInputError('invalid_object');
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, name);
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
            throw new NotificationInputError('invalid_object');
          }
          if (i) append(',');
          string(name);
          append(':');
          visit(descriptor.value, depth + 1);
        }
        append('}');
      }
    } finally {
      ancestors.delete(value);
    }
  }
  visit(input, 0);
  return chunks.join('');
}

export function decodeNotificationPayload(encoded: string): unknown {
  if (
    encoded.length > NOTIFICATION_PAYLOAD_LIMIT ||
    utf8Bytes(encoded) > NOTIFICATION_PAYLOAD_LIMIT
  ) {
    throw new NotificationInputError('input_too_large');
  }
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    throw new NotificationInputError('invalid_json');
  }
}
