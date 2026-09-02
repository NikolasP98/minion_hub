import { describe, expect, it } from 'vitest';
import {
  executeTool,
  getTools,
  hasTool,
  onToolChange,
  registerTool,
  registerTools,
} from './model-context';

describe('model-context registry', () => {
  it('registers, lists sorted, executes, and unregisters on abort', async () => {
    let changes = 0;
    const off = onToolChange(() => changes++);
    const ac = new AbortController();
    registerTool(
      {
        name: 'zeta',
        description: 'z',
        inputSchema: { type: 'object' },
        execute: (i) => ({ got: i }),
      },
      { signal: ac.signal },
    );
    registerTool(
      { name: 'alpha', description: 'a', inputSchema: { type: 'object' }, execute: () => 'hi' },
      { signal: ac.signal },
    );
    expect(getTools().map((t) => t.name)).toEqual(['alpha', 'zeta']);
    expect(await executeTool('alpha', {})).toBe('hi');
    expect(JSON.parse(await executeTool('zeta', { x: 1 }))).toEqual({ got: { x: 1 } });
    ac.abort();
    expect(hasTool('alpha')).toBe(false);
    expect(changes).toBe(4);
    off();
  });

  it('reports unknown and throwing tools as error results, never throws', async () => {
    const dispose = registerTools([
      {
        name: 'boom',
        description: '',
        inputSchema: {},
        execute: () => {
          throw new Error('nope');
        },
      },
    ]);
    expect(JSON.parse(await executeTool('boom', {}))).toEqual({ error: 'nope' });
    expect(JSON.parse(await executeTool('missing', {})).error).toMatch(/not available/);
    dispose();
    expect(hasTool('boom')).toBe(false);
  });
});
