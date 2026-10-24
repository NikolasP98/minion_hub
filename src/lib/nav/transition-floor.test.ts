import { describe, expect, it } from 'vitest';
import { MODULE_MANIFEST } from '$lib/modules/availability';
import { DATASET_ENFORCED } from '$lib/permissions';
import { floorApplies } from './custom-sections';

// Spec 037 I1‴: the module-view floor holds for a target until spec 039 guards its reads.
describe('transition floor', () => {
  it('applies to every module screen exactly when its module is not dataset-enforced', () => {
    for (const entry of Object.values(MODULE_MANIFEST))
      for (const prefix of entry.appPrefixes) {
        const target = `${prefix}/x`;
        const segment = target.split('/')[1];
        expect(floorApplies(target), target).toBe(!DATASET_ENFORCED.includes(segment));
      }
  });

  it('DATASET_ENFORCED growth is a visible diff', () => {
    expect([...DATASET_ENFORCED]).toMatchInlineSnapshot(`[]`);
  });
});
