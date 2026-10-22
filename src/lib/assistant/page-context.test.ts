import { describe, expect, it } from 'vitest';
import {
  getPageContext,
  getPageContextRevision,
  onPageContextChange,
  setPageContext,
  setPageContextLocation,
} from './page-context';
import { registerTool } from './model-context';
describe('page context registration ownership', () => {
  it('old equal-text disposal cannot clear the new owner', () => {
    const old = setPageContext('same');
    const current = setPageContext('same');
    const revision = getPageContextRevision();
    old();
    expect(getPageContext()).toBe('same');
    expect(getPageContextRevision()).toBe(revision);
    current();
    expect(getPageContext()).toBe('');
    expect(getPageContextRevision()).toBeGreaterThan(revision);
  });
  it('notifies monotonically on route/focus A → B → A and tool changes', () => {
    const seen: number[] = [];
    const off = onPageContextChange(() => seen.push(getPageContextRevision()));
    setPageContextLocation('/a');
    setPageContextLocation('/b');
    setPageContextLocation('/a');
    const dispose = registerTool({
      name: 'context-test',
      description: '',
      inputSchema: {},
      execute() {},
    });
    dispose();
    off();
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});
