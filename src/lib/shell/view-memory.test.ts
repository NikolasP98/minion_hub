import { describe, it, expect } from 'vitest';
import { ViewMemory, viewKey } from './view-memory';
describe('session view memory', () => {
  it('restores an exact view while keeping explicit links separate', () => {
    const memory = new ViewMemory();
    memory.reconcile('actor:org');
    const key = viewKey(new URL('https://hub.test/es/crm?q=ana'));
    memory.write('actor:org', key, { selected: ['1'], panels: ['peek'] });
    expect(memory.read('actor:org', key)).toEqual({ selected: ['1'], panels: ['peek'] });
    expect(memory.read('actor:org', '/es/crm?q=bob')).toBeUndefined();
  });
  it('clears on owner changes and rejects late teardown from the old owner', () => {
    const memory = new ViewMemory();
    memory.reconcile('a');
    memory.write('a', 'crm', 'private');
    memory.reconcile('b');
    memory.write('a', 'crm', 'late');
    expect(memory.read('a', 'crm')).toBeUndefined();
    expect(memory.read('b', 'crm')).toBeUndefined();
    memory.reconcile('a');
    expect(memory.read('a', 'crm')).toBeUndefined();
  });
  it('bounds memory and captures registered views before navigation', () => {
    const memory = new ViewMemory(2);
    memory.reconcile('a');
    const dispose = memory.register(() => memory.write('a', 'one', 1));
    memory.capture();
    memory.write('a', 'two', 2);
    memory.write('a', 'three', 3);
    expect(memory.read('a', 'one')).toBeUndefined();
    dispose();
    memory.capture();
    expect(memory.read('a', 'one')).toBeUndefined();
  });
});

it('keeps anonymous sibling identities distinct and makes disposal idempotent', () => {
  const memory = new ViewMemory();
  const first = memory.claim('/crm:name');
  const second = memory.claim('/crm:name');
  expect(first.id).toBe(0);
  expect(second.id).toBe(1);
  first.release();
  const replacement = memory.claim('/crm:name');
  expect(replacement.id).toBe(0);
  first.release();
  expect(memory.claim('/crm:name').id).toBe(2);
});
