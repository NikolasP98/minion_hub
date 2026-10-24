import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREFIX_MODULES,
  collect,
  moduleForLoadPath,
  readBaseline,
  violations,
} from '../../../scripts/dataset-read-baseline.mjs';
import { DATASET_ENFORCED } from '$lib/permissions';
import { MODULE_MANIFEST } from '$lib/modules/availability';

const baseline = readBaseline();
const enforced = [...DATASET_ENFORCED] as string[];
const messages = (rule: string, counts = collect()) =>
  violations(counts, baseline, enforced)
    .filter((v) => v.rule === rule)
    .map((v) => v.msg);

describe('dataset-read ratchet (spec 039)', () => {
  it('enforced modules have zero bare tenant reads', () => {
    expect(messages('enforced')).toEqual([]);
  });

  it('no file exceeds its baseline', () => {
    expect(messages('raised')).toEqual([]);
  });

  it('files outside the baseline have zero bare tenant reads', () => {
    expect(messages('unknown')).toEqual([]);
  });

  it('baseline has no stale keys (run scripts/dataset-read-baseline.mjs --update)', () => {
    expect(messages('stale')).toEqual([]);
  });

  it('route prefix map covers every MODULE_MANIFEST appPrefix', () => {
    const prefixes = Object.values(MODULE_MANIFEST).flatMap((e) => [...e.appPrefixes]);
    expect(prefixes.filter((p) => !(p in PREFIX_MODULES))).toEqual([]);
  });

  it('attributes loads to modules by longest prefix', () => {
    expect(moduleForLoadPath('src/routes/(app)/pos/appointments/+page.server.ts')).toBe('pos');
    expect(moduleForLoadPath('src/routes/(app)/finances/invoices/+page.server.ts')).toBe('finance');
    expect(moduleForLoadPath('src/routes/(app)/+layout.server.ts')).toBe('overview');
  });

  it('FAILS on a new unguarded read (fixture)', () => {
    const dir = path.resolve('src/routes/(app)/pos/_ratchet_fixture');
    const rel = 'src/routes/(app)/pos/_ratchet_fixture/+page.server.ts';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '+page.server.ts'),
        'export const load = async ({ locals }) => { const ctx = await getCoreCtx(locals); return { ctx }; };\n',
      );
      const counts = collect();
      expect(counts[rel]).toBe(1);
      expect(messages('unknown', counts)).toEqual([
        `${rel}: 1 bare tenant read(s) — use datasetCtx(locals, 'pos') / readDataset (spec 039 J1)`,
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(collect()[rel]).toBeUndefined();
  });
});
