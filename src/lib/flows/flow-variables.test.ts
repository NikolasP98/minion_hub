import { describe, it, expect } from 'vitest';
import { resolveFlowVariables, flowVariableSchema } from './flow-variables';
import type { VariableSpec } from './master-flows';

const specs: VariableSpec[] = [
  { key: 'a', type: 'int', label: 'A' },                          // default → enabled
  { key: 'b', type: 'int', label: 'B', defaultExported: false },  // default → disabled
];

describe('resolveFlowVariables', () => {
  it('applies toggle over defaultExported', () => {
    const r = resolveFlowVariables(specs, { b: true, a: false });
    expect(r.find((v) => v.key === 'a')!.enabled).toBe(false); // toggle wins
    expect(r.find((v) => v.key === 'b')!.enabled).toBe(true);
  });
  it('falls back to defaultExported (default true)', () => {
    const r = resolveFlowVariables(specs, {});
    expect(r.find((v) => v.key === 'a')!.enabled).toBe(true);
    expect(r.find((v) => v.key === 'b')!.enabled).toBe(false);
  });
});

describe('flowVariableSchema', () => {
  it('returns only enabled specs', () => {
    expect(flowVariableSchema(specs, {}).map((s) => s.key)).toEqual(['a']);
  });
});
