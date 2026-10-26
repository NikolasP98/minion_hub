import { describe, expect, it } from 'vitest';
import { getDoorKind, registeredDoorKinds } from './kinds';
import { getServerDoorKind } from '$server/doors/kinds';
import { getDoorPublic, loadDoorEditor, loadDoorPanels } from '$lib/components/doors/registry';

// The registries discover kinds by file convention (import.meta.glob). This
// proves the globs resolve under vitest and that an unregistered kind is
// simply absent — every caller turns that into a 404 / 400 `unknown_kind`.
describe('door kind registries', () => {
  it('returns undefined for a kind with no module', async () => {
    expect(getDoorKind('nope')).toBeUndefined();
    expect(getServerDoorKind('nope')).toBeUndefined();
    expect(getDoorPublic('nope')).toBeUndefined();
    expect(await loadDoorEditor('nope')).toBeUndefined();
    expect(await loadDoorPanels('nope')).toEqual([]);
  });

  it('only lists kinds that have a module', () => {
    for (const kind of registeredDoorKinds()) expect(getDoorKind(kind)?.kind).toBe(kind);
  });
});
