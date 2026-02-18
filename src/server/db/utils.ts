import { init } from '@paralleldrive/cuid2';

const createId = init({ length: 24 });

export function newId(): string {
  return createId();
}

export function nowMs(): number {
  return Date.now();
}
