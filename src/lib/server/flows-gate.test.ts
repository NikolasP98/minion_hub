import { describe, it, expect } from 'vitest';
import { shouldBlockFlowEditor } from './flows-gate';

type E = { pluginId: string; configEnabled?: boolean };

describe('shouldBlockFlowEditor', () => {
  it('blocks when flows entry is explicitly disabled', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows', configEnabled: false }] as E[])).toBe(true);
  });
  it('allows when flows enabled', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows', configEnabled: true }] as E[])).toBe(false);
  });
  it('allows when flows entry has no configEnabled flag', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'flows' }] as E[])).toBe(false);
  });
  it('allows (fail-open) when there is no flows entry', () => {
    expect(shouldBlockFlowEditor([{ pluginId: 'whatsapp', configEnabled: false }] as E[])).toBe(false);
  });
  it('allows when entries is empty', () => {
    expect(shouldBlockFlowEditor([])).toBe(false);
  });
});
